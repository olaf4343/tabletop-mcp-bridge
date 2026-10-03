# Atlas VTT MCP Bridge

**The agentic companion for [Atlas VTT](https://github.com/atlas-vtt/atlas-vtt).**

If your tabletop runs on Atlas VTT inside Obsidian, this plugin gives any
MCP-capable agent programmatic hands on it: your token and map library, image
reveals on the Atlas player window ("show the party this handout"), Atlas
settings, and the live Fantasy Statblocks bestiary that fills Atlas tables with
monsters — all as typed MCP tools.

> **What this is and isn't:** it is a bridge **for Atlas VTT setups**. Atlas VTT
> (and the Local REST API plugin that hosts the MCP server) is required; there is
> nothing here without it. Fantasy Statblocks and Fantasy Content Generator are
> optional companions that complete an Atlas table — each feature degrades
> gracefully, and `vtt_capabilities` always reports exactly what is reachable.

| In your Atlas setup | What an agent can then do through this bridge |
|---|---|
| **[Atlas VTT](https://github.com/atlas-vtt/atlas-vtt)** *(required)* | browse the asset library (tokens, maps), reveal images on the player window, read and safely change settings, run Atlas commands (send-map-to-player-view, dice log, initiative tracker, …) |
| **[Fantasy Statblocks](https://github.com/obsidian-ttrpg-community/fantasy-statblocks)** *(optional)* | read the **live** bestiary: SRD creatures *and* creatures defined by your own note frontmatter, in full — the bestiary Atlas tables draw from |
| **[Fantasy Content Generator](https://github.com/gregory-jagermeister/Fantasy-Content-Generator)** *(optional)* | run its commands through the allow-listed command runner |

Works with any client that speaks MCP — Claude Desktop, Claude Code, OpenCode,
Cursor, VS Code, or anything else that can reach a Streamable HTTP endpoint.
Everything stays on localhost, authenticated with your Local REST API key.
Nothing leaves your machine.

> **How it works:** this plugin does **not** host its own server. It uses the
> [Local REST API with MCP](https://github.com/coddingtonbear/obsidian-local-rest-api)
> plugin's public extension API (`getPublicApi`) to register tools and a REST
> subresource router into the MCP/REST server that plugin already runs. One
> endpoint, one API key, no extra ports.

---

## Requirements

- **Obsidian desktop** (the Local REST API plugin is desktop-only).
- **[Atlas VTT](https://github.com/atlas-vtt/atlas-vtt)** — the plugin this bridges.
- **[Local REST API with MCP](https://github.com/coddingtonbear/obsidian-local-rest-api) v5.x**, enabled. Its settings show the API key and ports; the MCP endpoint has been built in since v5.
- Optional: **[Fantasy Statblocks](https://github.com/obsidian-ttrpg-community/fantasy-statblocks)** (for the bestiary tools), **[Fantasy Content Generator](https://github.com/gregory-jagermeister/Fantasy-Content-Generator)** (for its commands).

## Setup

### 1. Install and enable the required plugins

Settings → Community plugins → Browse → install and enable **Atlas VTT** and
**"Local REST API"** (by Adam Coddington). In the REST plugin's settings, copy
the **API key** and note the ports (defaults: HTTPS on `27124`, plain HTTP on
`27123` if "Enable insecure server" is on).

> Tip: the plain-HTTP port avoids trusting the plugin's self-signed certificate
> and is the easiest to work with locally. The examples below assume it.

### 2. Install Atlas VTT MCP Bridge

Settings → Community plugins → Browse → **"Atlas VTT MCP Bridge"** → Install → Enable.

*(Manual install: copy this folder to `<vault>/.obsidian/plugins/atlas-vtt-mcp-bridge/`,
keeping `main.js` and `manifest.json`, then enable it in Community plugins.)*

On enable you should see a notice:
`Atlas VTT MCP Bridge: 11 tools (7 typed), REST routes at /vault/<note>/vtt-bridge/`.

### 3. Verify the bridge itself

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://127.0.0.1:27123/vault/<any-existing-note>/vtt-bridge/capabilities"
```

This reports that Atlas VTT was found, which companion plugins are present,
which features are active, and any load-time errors.
(`<any-existing-note>`: subresource routes mount under a real note path; any
note works, e.g. `index.md`.)

### 4. Point your MCP client at it

The MCP endpoint is the Local REST API plugin's: `http://127.0.0.1:27123/mcp/`
(Streamable HTTP), with header `Authorization: Bearer YOUR_API_KEY`.

**Claude Desktop** (`claude_desktop_config.json`; Claude Desktop speaks stdio, so proxy with `mcp-remote`):

```json
{
  "mcpServers": {
    "atlas-vtt": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:27123/mcp/",
               "--header", "Authorization: Bearer YOUR_API_KEY"]
    }
  }
}
```

**OpenCode** (`opencode.json`):

```jsonc
{
  "mcp": {
    "servers": {
      "Obsidian": {
        "type": "remote",
        "url": "http://127.0.0.1:27123/mcp/",
        "headers": { "Authorization": "Bearer YOUR_API_KEY" }
      }
    }
  }
}
```

**Any other Streamable HTTP client:** URL `http://127.0.0.1:27123/mcp/`,
header `Authorization: Bearer YOUR_API_KEY`.

After (re)connecting, your client should list tools starting with `vtt_`. Note
that clients snapshot the tool list at connect time — after (re)enabling the
bridge, restart the agent session to see it.

### 5. Try it

> “List the tokens in my Atlas asset library and show the Cleric on the player window.”

## Tools (MCP)

| Tool | Arguments | Description |
|---|---|---|
| `vtt_capabilities` | — | What's reachable: Atlas VTT + companions, versions, resolved services, active features, diagnostics. Call it first when something behaves oddly. |
| `vtt_list_collections` | — | Atlas collections with counts. |
| `vtt_list_assets` | `nameContains?` `type?` `collection?` `limit?` | Atlas asset library (tokens/maps) with image paths and tags. |
| `vtt_list_bestiary` | `source? (notes\|srd)` `nameContains?` `limit?` | Live Fantasy Statblocks bestiary (summaries). |
| `vtt_get_creature` | `name` | One creature in full, including frontmatter-defined ones. |
| `vtt_get_settings` | `key?` (dot path) | Full Atlas settings, or one value, e.g. `localPlayerView.showGrid`. |
| `vtt_set_setting` | `key`, `value` | Change a setting **through Atlas's own service**; unknown keys are refused; returns before/after. |
| `vtt_show_player_image` | `path` | Reveal an image on the Atlas player window (see caveat below). |
| `vtt_player_image_status` | — | Is an image currently displayed? |
| `vtt_dismiss_player_image` | — | Close the displayed image. |
| `vtt_execute_command` | `commandId` | Run a command of Atlas VTT or its companion plugins (prefix allow-list). |

## REST endpoints

The same operations, plus multi-criteria queries, under
`/vault/<any-existing-note>/vtt-bridge/` (authenticated like every other route):

| Method | Path | Query / body |
|---|---|---|
| GET | `/capabilities` | — |
| GET | `/collections` | — |
| GET | `/assets` | `collection`, `type`, `nameContains`, `limit` |
| GET | `/bestiary` | `name`, `source=notes\|srd`, `nameContains`, `limit` |
| GET | `/settings` | `key` (dot path allowed) |
| POST | `/settings` | `{key, value}` — key must already exist |
| GET | `/player-image` | — |
| POST | `/player-image` | `{path}` |
| DELETE | `/player-image` | — |
| POST | `/command` | `{commandId}` |

```bash
KEY=YOUR_API_KEY; BASE="http://127.0.0.1:27123/vault/index.md/vtt-bridge"
curl -s -H "Authorization: Bearer $KEY" "$BASE/assets?type=token&nameContains=cleric"
curl -s -H "Authorization: Bearer $KEY" "$BASE/bestiary?source=notes"
curl -s -H "Authorization: Bearer $KEY" "$BASE/settings?key=localPlayerView.showGrid"
curl -s -X POST -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"commandId":"atlas-vtt:send-map-to-player-view"}' "$BASE/command"
```

## Design notes

- **Safety.** Plugin-owned state is written only through the owning plugin's service
  APIs, never by rewriting another plugin's files behind its back. Settings writes
  require the key to already exist (a typo can't litter Atlas's settings). The
  command runner only accepts the id prefixes of Atlas VTT and its two companion
  plugins. Read-only tools are annotated `readOnlyHint: true`.
- **The live bestiary.** Frontmatter-defined creatures are *ephemeral* in Fantasy
  Statblocks: held in memory keyed by note path, never written to its `data.json`.
  An empty `monsters` array there proves nothing — the bridge reads the live
  registry instead. If the bestiary is still resolving (or `autoParse` is off), it
  reports `resolved: false` plus the command that fixes it, rather than pretending
  there are no creatures.
- **The player window.** Atlas shows agent-revealed images on its **player window**,
  which only exists when mirroring a loaded map (`atlas-vtt:send-map-to-player-view`).
  Without one, Atlas accepts image requests but mounts nothing — the bridge detects
  this and returns `ok:false` with the repair step instead of a misleading success.
- **Typed tool arguments.** The Local REST API extension API validates tool arguments
  with its bundled Zod and rejects foreign schema objects (the "Zod trap"). The bridge
  satisfies the exact internal contracts it finds there — `keyValidator._parse(input)`
  at call time, `_def.typeName`/`isOptional()` at schema-generation time — with a tiny
  hand-built validator (`zodish()` in `src/main.ts`). If a future host ever rejects
  it, each tool degrades to a parameterless variant and records the failure in
  `vtt_capabilities().diagnostics` instead of disappearing.
- **Reverse-engineered internals.** Atlas VTT ships no public API; the bridge resolves
  its internal services by property name at call time (never cached across reloads)
  and `vtt_capabilities` reports what it found. A future Atlas release that renames
  internals shows up there first.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Notice: "please install and enable the Local REST API plugin" | The bridge requires it (it will try to auto-enable it if merely disabled). Install/enable it, then re-enable the bridge. |
| `vtt_capabilities` reports `atlas-vtt: present: false` | This bridge is built for Atlas VTT — install and enable it. |
| `vtt_*` tools missing in the agent | Clients sync the tool list at connect time. Restart the agent session. Also confirm the bridge loaded (step 3). |
| `401 / errorCode 40001` | Wrong or missing API key. Use the key from the Local REST API settings, header `Authorization: Bearer …`. |
| `404` on subresource routes | The path must include a real note: `/vault/<existing-note>/vtt-bridge/...`. |
| TLS/certificate errors | Use the plugin's plain-HTTP port (enable "insecure server") or trust the plugin's CA. |
| `vtt_list_bestiary` returns `resolved: false` right after startup | Run *Fantasy Statblocks: Parse Frontmatter for Creatures* (`vtt_execute_command`), or enable Statblocks' *auto-parse* setting. |
| `vtt_show_player_image` says player window not open | Load a map in Atlas VTT first, then `vtt_execute_command` → `atlas-vtt:send-map-to-player-view`, then reveal. |
| Something else unexplained | Read `vtt_capabilities()` — it reports plugin presence/versions, resolved services, and the bridge's own load diagnostics. |

## Compatibility

Built and tested against: Obsidian 1.13.x, Local REST API with MCP 5.3.1,
Atlas VTT 0.4.2, Fantasy Statblocks 4.10.3, Fantasy Content Generator 1.2.4.
The bridge uses only the extension API (`getPublicApi`, v3) plus at-call-time
feature detection, so it loads harmlessly when a companion plugin is missing —
`vtt_capabilities` shows what it can see.

## Development

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # type-check + production bundle
```

Structure: `src/main.ts` (single entry point: registration, capability probe,
bestiary/asset/settings/command implementations). Install into a test vault by
copying `manifest.json` + `main.js` to `<vault>/.obsidian/plugins/atlas-vtt-mcp-bridge/`.
To reload the plugin code during development, run the Obsidian command
*Reload app without saving* (`app:reload`).

## Provenance

This plugin was developed end-to-end with AI tooling, and it says so on purpose:

- The private 0.x line (as the *DSH Atlas Bridge*) was created first in the
  **DeepSeek Harness** (Windows app, v0.2) using the **DeepSeek v4.1 flash** model.
- The work was then continued in **OpenCode** on a local machine using a
  **quantized Qwen 3.8 Flash Next** model, which produced the typed-arguments
  breakthrough, the public 1.0.0 design, documentation and tests.

It is offered in that same spirit: an agent-facing companion for Atlas VTT, built
by agents, with every documented behavior measured against the installed plugins
rather than assumed. Full history in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
