# Changelog

All notable changes to Tabletop MCP Bridge.

This plugin was built end-to-end with AI tooling, and credits it openly:

- The **0.x line** (as the private *DSH Atlas Bridge*) was created first in the
  **DeepSeek Harness** (Windows app, v0.2) with the **DeepSeek v4.1 flash** model.
- The work was then **continued in OpenCode** on a local machine with a
  **quantized Qwen 3.8 Flash Next** model, producing 0.3.0 and the public 1.0.0.

Every claim in the documentation was measured against the installed plugins
(Obsidian 1.13.x, Local REST API with MCP 5.3.1, Atlas VTT 0.4.2,
Fantasy Statblocks 4.10.3, Fantasy Content Generator 1.2.4).

## [1.0.0] - 2026-10-03

First public community-plugin release: **Tabletop MCP Bridge** (id `tabletop-mcp-bridge`).

- Renamed from the private `dsh-atlas-bridge`; MCP tools are now namespaced `vtt_*`
  (the old `atlas_` prefix wrongly implied Atlas-only — the bestiary is Statblocks),
  REST prefix `/vtt-bridge/`.
- Proper TypeScript source (`src/main.ts`) with an esbuild pipeline
  (`npm run build` = type-check + production bundle).
- Dependency-aware loading: if the Local REST API plugin is installed but disabled,
  the bridge enables it and retries registration once, instead of staying silent.
- Buffer-free request-body parsing; MCP registrations cleaned via Obsidian's
  `register()` lifecycle in addition to the host's own teardown.
- Public documentation: per-client setup (Claude Desktop via `mcp-remote`,
  OpenCode, generic Streamable-HTTP), tool/REST references, troubleshooting,
  design notes.
- Release build verified by a 27-check test suite (REST + raw MCP JSON-RPC,
  typed-argument round-trips, error paths, state restoration).

## [0.3.0] - private (DSH Atlas Bridge)

- **Parameterized MCP tools via the `zodish()` validator shim.** The earlier
  conclusion that the host's extension API makes typed MCP arguments impossible
  (the "Zod trap") was a misreading: reading the host's bundled Zod v3 +
  zod-to-json-schema showed the exact contracts (`keyValidator._parse(input)` at
  call time; `_def.typeName`/`isOptional()` at schema-generation time), and a
  hand-built validator satisfies both. 11 tools, 7 with typed arguments.
- Added `atlas_get_creature`, `atlas_player_image_status`, `atlas_show_player_image`,
  `atlas_set_setting`, `atlas_execute_command`; filters on the list tools;
  `key` (dot path) on settings reads.
- Settings writes validate the key before writing (a typo'd POST used to create
  junk settings silently); responses include before/after.
- `GET /player-image` status; the show action reports an honest `ok:false` with the
  repair step when Atlas accepted an image but no player window existed.
- Registration failures degrade to parameterless variants with diagnostics instead
  of failing the whole bridge.

## [0.2.0] - private

- Capabilities inventory (plugins, versions, resolved Atlas runtime services),
  live Fantasy Statblocks API probe, `DELETE /player-image`.

## [0.1.1] - private

- Commands resolved against the raw command registry instead of
  `listCommands()` — the availability filter was a pure false negative for the
  Atlas VTT panel toggles. Unknown ids still return `No such command`; commands
  that exist but decline report `executed: false` with a note.

## [0.1.0] - private

- Initial bridge: parameterless read-only MCP tools plus a vault-subresource REST
  router for everything needing arguments, both sharing one implementation.
