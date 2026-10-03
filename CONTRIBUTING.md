# Contributing

**Pull requests are open and genuinely welcome.** This is a 0.x plugin: it works,
but it expects to find bugs, and most fixes don't require knowing the whole code
base. No process gates — open a PR; for anything larger than a fix, open an
issue first so we can align before you invest effort.

## Dev loop

```bash
npm install
npm run dev      # esbuild watch -> main.js
npm run build    # type-check + production bundle (CI equivalent: this + npm test)
```

Install into a test vault by copying `main.js` + `manifest.json` into
`<vault>/.obsidian/plugins/atlas-vtt-mcp-bridge/` and enabling the plugin.
During development, run the Obsidian command *Reload app without saving*
(`app:reload`) to reload plugin code; then wait a few seconds for the bridge to
re-register (poll its `/capabilities` route until it reports your version).

## Tests

`npm test` runs the regression suite in `test/bridge.test.mjs` against a **live**
Obsidian (the plugin only exists at runtime, so the suite is integration-style —
no mocks). It needs the same environment your MCP client uses:

```bash
OBSIDIAN_API_KEY=<the key in Local REST API settings> \
OBSIDIAN_BASE=http://127.0.0.1:27124 \
OBSIDIAN_NOTE=index.md \
npm test
```

The suite covers both channels (REST subroutes and raw MCP JSON-RPC), typed
argument schemas, error paths, and restores any settings it touches. Checks that
need vault-specific material (an asset, a creature, an open player window)
**SKIP rather than FAIL** when that material is absent — but every PASS should
stay a PASS. A PR is mergeable when previously-passing checks still pass.

If the bestiary checks skip on your vault, run *Fantasy Statblocks: Parse
Frontmatter for Creatures* first (`vtt_execute_command`) or enable Statblocks'
auto-parse setting.

## How the code is organized

Everything lives in `src/main.ts`, deliberately — Obsidian community plugins
ship as one bundled file, and the bridge is one coherent subsystem:

- It registers into the **Local REST API with MCP** plugin's extension API
  (`getPublicApi`), it does not host a server of its own.
- `zodish()` is a tiny validator that satisfies the host's internal Zod
  contracts so MCP tools get typed arguments (see the "Typed tool arguments"
  design note in README.md before changing it — this is the load-bearing trick).
- Atlas VTT has no public API; its internal services are resolved **by property
  name at call time**, never cached across reloads, and `vtt_capabilities`
  reports exactly what was found. When an Atlas update breaks something,
  `vtt_capabilities().diagnostics` is where the answer is.
- Safety invariants to preserve: settings writes only through Atlas's own
  service and only for existing keys; commands only for the three tabletop
  plugin prefixes; never rewrite another plugin's data files.

## Where help is especially welcome

- **Player-window positive path.** Revealing images on an open Atlas player
  window has never been exercised in a test run (the dev vault has no maps).
  If your Atlas setup can open the player window, running `npm test` there and
  reporting what happens is a real contribution.
- **Atlas internal drift.** Atlas VTT ships minified internals. If a future
  Atlas version makes `vtt_capabilities` report a service as unresolved, an
  issue with that output attached is immediately actionable.
- **More fixtures/coverage** for the test suite, docs improvements, screenshots,
  and per-client setup guides for clients not covered yet.
