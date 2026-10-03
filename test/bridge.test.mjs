// Regression suite for Atlas VTT MCP Bridge: REST (/vtt-bridge) + raw MCP (vtt_* tools).
//
// Requires a running Obsidian with this plugin, Fantasy Statblocks and the
// Local REST API plugin enabled. Configure with environment variables:
//
//   OBSIDIAN_API_KEY   the Local REST API settings' API key            (required)
//   OBSIDIAN_BASE      e.g. http://127.0.0.1:27124  (the plugin's port, http or https)
//   OBSIDIAN_NOTE      path to ANY existing note in the vault, e.g. index.md (required)
//
//   OBSIDIAN_API_KEY=... OBSIDIAN_BASE=http://127.0.0.1:27124 OBSIDIAN_NOTE=index.md npm test
//
// Checks that depend on specific vault content (a named asset, a creature, an
// open player window) are fixture-aware: they adapt to whatever your library and
// bestiary contain, and SKIP rather than FAIL when a feature's material is absent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_KEY = process.env.OBSIDIAN_API_KEY;
const BASE0 = process.env.OBSIDIAN_BASE;
const NOTE = process.env.OBSIDIAN_NOTE;
if (!API_KEY || !BASE0 || !NOTE) {
  console.error('usage: OBSIDIAN_API_KEY=... OBSIDIAN_BASE=http://127.0.0.1:PORT OBSIDIAN_NOTE=<any-note-path> npm test');
  console.error('(all three come from your Local REST API settings / vault; see CONTRIBUTING.md)');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json'), 'utf8'));
const BASE = `${BASE0.replace(/\/$/, '')}/vault/${NOTE}/vtt-bridge`;
const MCP = `${BASE0.replace(/\/$/, '')}/mcp/`;
const AUTH = { Authorization: `Bearer ${API_KEY}` };

let pass = 0, fail = 0, skipped = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' -- ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};
const skip = (label, why) => { skipped++; console.log(`SKIP ${label} (${why})`); };

// ---------- REST channel ----------
const rest = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { ...opts, headers: { ...AUTH, ...(opts.headers || {}) } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200), _status: res.status }; }
};
const post = (path, body) => rest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

console.log('--- REST ---');
let j = await rest('/capabilities');
check('plugin identity matches manifest', j.ok === true && j.bridge.id === manifest.id && j.bridge.name === manifest.name && j.bridge.version === manifest.version, j.bridge);
check('load diagnostics clean', Array.isArray(j.diagnostics?.errors) && j.diagnostics.errors.length === 0, j.diagnostics);
check('typed channel active', j.mcp?.argumentChannel === 'zodish' && (j.mcp?.parameterizedTools?.length ?? 0) >= 7, j.mcp);
check('Atlas VTT reachable (this bridge is for Atlas)', j.plugins?.['atlas-vtt']?.present === true, j.plugins);

const settings = await rest('/settings');
const probeKey = settings.ok && typeof settings.settings?.laserPointer?.size === 'number' ? 'laserPointer.size' : null;
j = await rest('/settings?key=localPlayerView.showGrid');
check('settings dot-path read', j.ok === true && typeof j.value === 'boolean', j);
j = await post('/settings', { key: '__junk_probe__', value: 1 });
check('unknown settings key refused', j.ok === false && j.error?.includes('Unknown settings key'), j);
if (probeKey) {
  const before = settings.settings.laserPointer.size;
  j = await post('/settings', { key: probeKey, value: before + 5 });
  const wrote = j.ok === true && j.after === before + 5;
  j = await post('/settings', { key: probeKey, value: before });
  check(`settings write round-trip (${probeKey})`, wrote && j.ok === true && j.after === before, j);
} else {
  skip('settings write round-trip', 'no laserPointer.size in this Atlas settings.json');
}
j = await rest('/player-image');
check('player-image status', j.ok === true && typeof j.isImageDisplayed === 'boolean', j);
const playerWindowOpen = j.ok === true && j.isImageDisplayed === true;
j = await post('/command', { commandId: 'atlas-vtt:toggle-dice-log' });
const exec1 = j.ok === true && j.executed === true;
j = await post('/command', { commandId: 'atlas-vtt:toggle-dice-log' });
check('command on/off pair executes', exec1 && j.ok === true && j.executed === true, j);

const allAssets = await rest('/assets');
if (allAssets.ok && allAssets.assets?.length) {
  const target = allAssets.assets[0];
  const frag = target.name.slice(0, Math.min(3, target.name.length));
  j = await rest('/assets?nameContains=' + encodeURIComponent(frag));
  check('asset filter finds a known asset by name fragment',
    j.ok === true && j.assets.some((a) => a.name === target.name), { frag, target: target.name });
} else {
  skip('asset filter', 'asset library is empty in this vault');
}
const bsList = await rest('/bestiary?limit=5');
if (bsList.ok && bsList.creatures?.length) {
  const name = bsList.creatures[0].name;
  j = await rest('/bestiary?name=' + encodeURIComponent(name));
  check('bestiary lookup by exact name', j.ok === true && j.creature?.name === name, { name });
} else {
  skip('bestiary lookup', 'bestiary empty or unresolved - run "Parse Frontmatter for Creatures" via vtt_execute_command, or enable Statblocks auto-parse');
}

// ---------- MCP channel ----------
let sessionId = null;
const mcp = async (method, params, id) => {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params }),
  });
  if (!sessionId) sessionId = res.headers.get('mcp-session-id');
  const text = await res.text();
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
  return dataLine ? JSON.parse(dataLine.slice(5)) : (() => { try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200) }; } })();
};
const callTool = async (name, args, id) => {
  const r = await mcp('tools/call', { name, arguments: args }, id);
  if (r.error) return { _jsonrpcError: r.error };
  const text = r.result?.content?.[0]?.text || '';
  try { return JSON.parse(text); } catch { return { _unparsed: text.slice(0, 300) }; }
};

await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '3.0' } }, 0);
await mcp('notifications/initialized', {});
const tools = (await mcp('tools/list', {}, 1)).result?.tools || [];
const vtt = tools.filter((t) => t.name.startsWith('vtt_'));
const other = tools.filter((t) => t.name.startsWith('atlas_'));
console.log(`--- MCP tools: vtt=${vtt.length}, leftover atlas_=${other.length} ---`);
check('11 vtt_ tools registered', vtt.length === 11, vtt.map((t) => t.name));
check('no stale atlas_ tools', other.length === 0, other.map((t) => t.name));
const showT = vtt.find((t) => t.name === 'vtt_show_player_image');
check('typed schema: path:string required', showT?.inputSchema?.properties?.path?.type === 'string' && (showT?.inputSchema?.required || []).includes('path'), showT?.inputSchema);

let r = await callTool('vtt_get_settings', { key: 'localPlayerView.showGrid' }, 11);
check('vtt_get_settings dot key', r.ok === true && typeof r.value === 'boolean', r);
if (probeKey) {
  const before = settings.settings.laserPointer.size;
  r = await callTool('vtt_set_setting', { key: probeKey, value: before + 3 }, 12);
  const rt1 = r.ok === true && r.after === before + 3;
  r = await callTool('vtt_set_setting', { key: probeKey, value: before }, 13);
  check('vtt_set_setting round-trip via MCP', rt1 && r.ok === true && r.after === before, r);
} else {
  skip('vtt_set_setting round-trip', 'no writable probe key (laserPointer.size) in this vault');
}
r = await callTool('vtt_list_bestiary', { nameContains: 'aboleth', limit: 1 }, 14);
if (r.ok === true && r.creatures?.length) {
  check('vtt_list_bestiary SRD search', r.creatures[0].name.toLowerCase().includes('aboleth'), r.creatures);
} else {
  skip('vtt_list_bestiary SRD search', 'SRD not resolved (see CONTRIBUTING.md on frontmatter parsing)');
}
r = await callTool('vtt_execute_command', { commandId: 'core:something' }, 18);
check('non-tabletop command refused', r.ok === false && r.error?.includes('Refused'), r);
if (allAssets.ok && allAssets.assets?.length) {
  const path = allAssets.assets[0].imagePath || allAssets.assets[0].path;
  if (playerWindowOpen) {
    r = await callTool('vtt_show_player_image', { path }, 19);
    const shown = r.ok === true;
    await callTool('vtt_dismiss_player_image', {}, 20);
    check('player-image show + dismiss (window open)', shown, r);
  } else {
    r = await callTool('vtt_show_player_image', { path }, 19);
    check('show without player window -> honest ok:false + repair step',
      r.ok === false && r.error?.includes('Player window not open') && r.note?.includes('send-map-to-player-view'), r);
  }
} else {
  skip('player-image reveal', 'no assets to reveal');
}
r = await callTool('vtt_player_image_status', {}, 21);
check('player-image status via MCP', r.ok === true && typeof r.isImageDisplayed === 'boolean', r);
r = await callTool('vtt_dismiss_player_image', {}, 22);
check('dismiss ok', r.ok === true, r);

// final state check
if (probeKey) {
  j = await rest(`/settings?key=${probeKey}`);
  check(`final state: ${probeKey} restored`, j.ok === true && j.value === settings.settings.laserPointer.size, j);
}

console.log(`\n==== ${pass} passed, ${fail} failed, ${skipped} skipped ====`);
process.exit(fail ? 1 : 0);
