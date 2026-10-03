# Changelog

All notable changes to Atlas VTT MCP Bridge.

This plugin was built end-to-end with AI tooling, and credits it openly:

- The **private prehistory** (as the *DSH Atlas Bridge*) was created first in the
  **DeepSeek Harness** (Windows app, v0.2) with the **DeepSeek v4.1 flash** model.
- The work was then **continued in OpenCode** on a local machine with a
  **quantized Qwen 3.8 Flash Next** model, producing the typed-arguments
  breakthrough and the first public release.

Two version lines exist, and they are separate: the private predecessor was a
different plugin (`dsh-atlas-bridge`) with its own 0.x numbering, listed at the
bottom as prehistory. **The public version line of this plugin starts at 0.1.0** —
deliberately, see below.

Every claim in the documentation was measured against the installed plugins
(Obsidian 1.13.x, Local REST API with MCP 5.3.1, Atlas VTT 0.4.2,
Fantasy Statblocks 4.10.3, Fantasy Content Generator 1.2.4).

## [0.1.0] - 2026-10-03

First public community-plugin release: **Atlas VTT MCP Bridge** (id `atlas-vtt-mcp-bridge`).

- **Deliberately versioned 0.1.0, not 1.0.0.** This is an early-stage,
  AI-built tool: it works and it is tested, but it surely has bugs and missing
  features that only wider use will surface. The 0.x line says so; findings
  belong in [issues](https://github.com/olaf4343/atlas-vtt-mcp-bridge/issues),
  and pull requests are open and welcome.
- Named for what it is: the agentic companion for **Atlas VTT**. The tentative
  early name "Tabletop MCP Bridge" was dropped before directory submission -
  the only tabletop setup this works with is one built on Atlas VTT.
- MCP tools are namespaced `vtt_*`, REST prefix `/vtt-bridge/`.
- Proper TypeScript source (`src/main.ts`) with an esbuild pipeline
  (`npm run build` = type-check + production bundle).
- Dependency-aware loading: if the Local REST API plugin is installed but disabled,
  the bridge enables it and retries registration once, instead of staying silent.
- Buffer-free request-body parsing; MCP registrations cleaned via Obsidian's
  `register()` lifecycle in addition to the host's own teardown.
- Public documentation: per-client setup (Claude Desktop via `mcp-remote`,
  OpenCode, generic Streamable-HTTP), tool/REST references, troubleshooting,
  design notes, contributor guide.
- The regression suite used to verify this release is bundled in the repo
  (`test/bridge.test.mjs`): REST + raw MCP JSON-RPC, typed-argument round-trips,
  error paths, state restoration — fixture-aware so it degrades gracefully on
  other vaults. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Prehistory — DSH Atlas Bridge (private, separate version line)

The private predecessor plugin (`dsh-atlas-bridge`, never published). Kept here
for provenance; its numbers are **not** part of this plugin's version line.

### [0.3.0]

- **Parameterized MCP tools via the `zodish()` validator shim.** The earlier
  conclusion that the host's extension API makes typed MCP arguments impossible
  (the "Zod trap") was a misreading: reading the host's bundled Zod v3 +
  zod-to-json-schema showed the exact contracts (`keyValidator._parse(input)` at
  call time; `_def.typeName`/`isOptional()` at schema-generation time), and a
  hand-built validator satisfies both. 11 tools, 7 with typed arguments.
- Added creature lookup, player-image status/show, settings write, command
  execution; filters on the list tools; `key` (dot path) on settings reads.
- Settings writes validate the key before writing (a typo'd POST used to create
  junk settings silently); responses include before/after.
- Player-image status endpoint; the show action reports an honest `ok:false` with
  the repair step when Atlas accepted an image but no player window existed.
- Registration failures degrade to parameterless variants with diagnostics
  instead of failing the whole bridge.

### [0.2.0]

- Capabilities inventory (plugins, versions, resolved Atlas runtime services),
  live Fantasy Statblocks API probe, player-image dismiss.

### [0.1.1]

- Commands resolved against the raw command registry instead of
  `listCommands()` — the availability filter was a pure false negative for the
  Atlas VTT panel toggles. Unknown ids still return `No such command`; commands
  that exist but decline report `executed: false` with a note.

### [0.1.0]

- Initial bridge: parameterless read-only MCP tools plus a vault-subresource REST
  router for everything needing arguments, both sharing one implementation.
