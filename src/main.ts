/*
 * Atlas VTT MCP Bridge
 * ====================
 * The agent companion for Atlas VTT: gives any MCP-capable agent (Claude, GPT,
 * OpenCode, Cursor, ...) programmatic reach into the Atlas VTT setup of an
 * Obsidian vault - Atlas VTT itself, plus the tabletop plugins that complete an
 * Atlas table: Fantasy Statblocks and Fantasy Content Generator.
 *
 * WHY THIS EXISTS
 * ---------------
 * Atlas VTT exposes no API of its own (it is minified and ships no public
 * surface); the same holds for its companion plugins. The supported way in is
 * the Local REST API with
 * MCP plugin's public extension API:
 *
 *     app.plugins.plugins['obsidian-local-rest-api'].getPublicApi(manifest)
 *
 * That plugin hosts the actual MCP server (and a REST API); this bridge
 * registers first-class MCP tools and a parameterized REST subresource router
 * into it. Nothing is exposed over the network that is not bound to localhost,
 * and everything is protected by the Local REST API plugin's API key.
 *
 * TYPED MCP TOOL ARGUMENTS (the "Zod trap", opened)
 * --------------------------------------------------
 * addMcpTool(name, description, schema, callback) runs zod.object(schema)
 * internally, so `schema` must be a Zod RAW SHAPE. Plain objects and JSON
 * Schema objects register happily but fail at CALL time
 * ("keyValidator._parse is not a function"), and an empty shape silently
 * strips every argument. Reading the host's bundled sources shows nothing here
 * needs Zod *instances*:
 *
 *   - at call time, ZodObject._parse calls keyValidator._parse(input) and
 *     consumes the returned { status, value }; input.data is the raw value.
 *   - at registration time, zod-to-json-schema reads only _def.typeName,
 *     _def.description and isOptional(); entries without a _def are dropped
 *     from the advertised schema.
 *
 * A hand-built validator with exactly { _def, isOptional, _parse } is accepted
 * by both halves - that is what zodish() builds. Parsing is deliberately
 * permissive (identity): the advertised JSON Schema guides the caller, and the
 * bridge validates arguments itself with friendly errors.
 *
 * SAFETY
 * ------
 * Plugin-owned state is written only through the owning plugin's own service
 * APIs; the bridge never rewrites another plugin's data files behind its back.
 * Settings writes require an existing key. Commands are restricted to the
 * three tabletop plugins' id prefixes.
 *
 * PROVENANCE
 * ----------
 * The private 0.x line ("DSH Atlas Bridge") was created in the DeepSeek
 * Harness using the DeepSeek v4.1 flash model; the public 1.0.0 was continued
 * in OpenCode with a local quantized Qwen 3.8 Flash Next. See CHANGELOG.md.
 */
import { Plugin, Notice } from 'obsidian';

const REST_PLUGIN_ID = 'obsidian-local-rest-api';
const ATLAS_PLUGIN_ID = 'atlas-vtt';
const STATBLOCKS_PLUGIN_ID = 'obsidian-5e-statblocks';
const GENERATOR_PLUGIN_ID = 'fantasy-content-generator';

const ROUTE_PREFIX = 'vtt-bridge';
const ATLAS_ASSETS_PATH = 'atlas-vtt/.atlas-data/assets-metadata.json';
const ATLAS_SETTINGS_PATH = 'atlas-vtt/.atlas-data/settings.json';
const TABLETOP_COMMAND_PREFIXES = ['atlas-vtt:', 'obsidian-5e-statblocks:', 'fantasy-content-generator:'];

export default class AtlasVttMcpBridge extends Plugin {
  api: any = null;
  registered = false;
  registeredTools: string[] = [];
  parameterizedTools: string[] = [];
  mcpCleanups: Array<() => void> = [];
  diagnostics: any = { loadedAt: new Date().toISOString(), errors: [], mcpArgumentChannel: 'none' };
  restRetryScheduled = false;

  async onload() {
    this.diagnostics = { loadedAt: new Date().toISOString(), errors: [], mcpArgumentChannel: 'none' };

    const api = this.getRestApi();
    if (api) {
      this.api = api;
      this.registerAll();
    } else {
      this.diagnostics.unavailable = 'obsidian-local-rest-api is not reachable';
      this.attemptRestRecovery();
    }

    // Belt and braces: Obsidian calls this on unload even if registerAll() never ran.
    this.register(() => () => this.cleanupMcp());
  }

  private registerAll(): void {
    if (this.registered) return;
    this.registered = true;
    this.registerSubresourceRoutes(this.api);
    this.registerMcpTools(this.api);
    try {
      new Notice('Atlas VTT MCP Bridge: ' + this.registeredTools.length + ' tools (' + this.parameterizedTools.length + ' typed), REST routes at /vault/<note>/' + ROUTE_PREFIX + '/');
    } catch (e) { /* ignore */ }
  }

  /**
   * The most common setup failure is load order: this plugin loading before
   * the Local REST API is enabled. Try to enable it if it is installed but
   * off, retry registration once shortly, and only then report the missing
   * dependency.
   */
  private attemptRestRecovery(): void {
    if (this.restRetryScheduled) return;
    this.restRetryScheduled = true;
    try {
      const pm: any = (this.app as any).plugins;
      const manifest = pm && pm.manifests && pm.manifests[REST_PLUGIN_ID];
      if (manifest && pm.enabledPlugins && !pm.enabledPlugins.has(REST_PLUGIN_ID) && typeof pm.enablePlugin === 'function') {
        this.diagnostics.restRecovery = 'attempting to enable ' + REST_PLUGIN_ID;
        void pm.enablePlugin(REST_PLUGIN_ID);
      }
    } catch (e) { /* best effort */ }

    setTimeout(() => {
      if (this.registered) return;
      const api = this.getRestApi();
      if (api) {
        this.api = api;
        this.diagnostics.restRecovery = 'enabled and registered on retry';
        this.registerAll();
      } else {
        try {
          new Notice('Atlas VTT MCP Bridge: please install and enable the "Local REST API with MCP" community plugin first.');
        } catch (e) { /* ignore */ }
      }
    }, 1500);
  }

  // =====================================================================
  // Registration
  // =====================================================================

  private getRestApi(): any {
    try {
      const plugins: any = (this.app as any).plugins && (this.app as any).plugins.plugins;
      if (!plugins) return null;
      const plugin = plugins[REST_PLUGIN_ID];
      if (!plugin || typeof plugin.getPublicApi !== 'function') return null;
      return plugin.getPublicApi(this.manifest) || null;
    } catch (err) {
      this.diagnostics.errors.push({ where: 'getPublicApi', error: this.describe(err) });
      return null;
    }
  }

  /**
   * The parameterized half of the bridge: one authenticated Express router,
   * mounted under every note, exposing every operation over plain REST.
   */
  private registerSubresourceRoutes(api: any): void {
    let router: any;
    try {
      router = api.addVaultSubresource(ROUTE_PREFIX);
    } catch (err) {
      this.diagnostics.errors.push({ where: 'addVaultSubresource', error: this.describe(err) });
      return;
    }
    if (!router || typeof router.get !== 'function') {
      this.diagnostics.errors.push({ where: 'addVaultSubresource', error: 'no router returned' });
      return;
    }

    const bridge = this;
    router.get('/capabilities', async (_req: any, res: any) => this.send(res, await bridge.capabilities()));
    router.get('/collections', async (_req: any, res: any) => this.send(res, await bridge.listCollections()));
    router.get('/assets', async (req: any, res: any) => {
      this.send(res, await bridge.listAssets({
        collection: req.query.collection,
        type: req.query.type,
        nameContains: req.query.nameContains,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    });
    router.get('/bestiary', async (req: any, res: any) => {
      this.send(res, bridge.readBestiary({
        name: req.query.name,
        source: req.query.source,
        nameContains: req.query.nameContains,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    });
    router.get('/settings', async (req: any, res: any) => this.send(res, await bridge.getSettings({ key: req.query.key })));
    router.post('/settings', async (req: any, res: any) => {
      const body = this.body(req);
      this.send(res, await bridge.setSetting({ key: body.key, value: body.value }));
    });
    router.get('/player-image', async (_req: any, res: any) => this.send(res, await bridge.playerImageStatus()));
    router.post('/player-image', async (req: any, res: any) => {
      const body = this.body(req);
      this.send(res, await bridge.showImageOnPlayerView({ path: body.path }));
    });
    router.delete('/player-image', async (_req: any, res: any) => this.send(res, await bridge.dismissPlayerImage()));
    router.post('/player-image/dismiss', async (_req: any, res: any) => this.send(res, await bridge.dismissPlayerImage()));
    router.post('/command', async (req: any, res: any) => {
      const body = this.body(req);
      this.send(res, await bridge.executeTabletopCommand({ commandId: body.commandId }));
    });

    this.diagnostics.routesMounted = true;
  }

  /**
   * A hand-built validator the host's bundled Zod v3 accepts (see header).
   * `type` is one of: string | number | boolean | json.
   */
  private zodish(type: string, description?: string, opts?: any): any {
    const typeNameByType: any = { string: 'ZodString', number: 'ZodNumber', boolean: 'ZodBoolean', json: 'ZodAny' };
    const zodTypeName = typeNameByType[type] || 'ZodAny';
    const def: any = { typeName: zodTypeName };
    if (description) def.description = description;
    if (opts && opts.optional) {
      return {
        _def: { typeName: 'ZodOptional', innerType: { _def: def } },
        isOptional: () => true,
        _parse: (input: any) => ({ status: 'valid', value: input.data }),
      };
    }
    return {
      _def: def,
      isOptional: () => false,
      _parse: (input: any) => ({ status: 'valid', value: input.data }),
    };
  }

  /** Build a Zod raw shape from a plain spec: { arg: { type, description, optional } }. */
  private toolShape(spec: any): any {
    const shape: any = {};
    for (const name of Object.keys(spec || {})) {
      const arg = spec[name];
      shape[name] = this.zodish(arg.type, arg.description, { optional: Boolean(arg.optional) });
    }
    return shape;
  }

  private registerMcpTools(api: any): void {
    const bridge = this;
    const tools: any[] = [
      {
        name: 'vtt_capabilities',
        description:
          'Report which plugins the Atlas VTT MCP Bridge can reach (Atlas VTT and its companion plugins), which Atlas VTT runtime services are available, and which bridge features are active. Call this first if another tool returns something unexpected, or after upgrading a plugin, to see what changed.',
        run: () => bridge.capabilities(),
        readOnly: true,
      },
      {
        name: 'vtt_list_collections',
        description: 'List Atlas VTT asset collections with id, name, description, uid and asset counts.',
        run: () => bridge.listCollections(),
        readOnly: true,
      },
      {
        name: 'vtt_list_assets',
        description:
          'List assets registered in the Atlas VTT asset library (tokens, maps and other images) with image path, collection and tags. Call this to discover what art exists before adding tokens to a map or showing an image on the player window. All arguments are optional filters; with no arguments every asset is returned (up to 200).',
        args: {
          nameContains: { type: 'string', optional: true, description: 'Case-insensitive substring match against the asset name.' },
          type: { type: 'string', optional: true, description: 'Exact asset type filter, e.g. "token" or "map".' },
          collection: { type: 'string', optional: true, description: 'Exact collection id, e.g. "Default".' },
          limit: { type: 'number', optional: true, description: 'Maximum number of assets to return (default 200).' },
        },
        run: (args: any) => bridge.listAssets({
          collection: args.collection,
          type: args.type,
          nameContains: args.nameContains,
          limit: args.limit,
        }),
        readOnly: true,
      },
      {
        name: 'vtt_list_bestiary',
        description:
          'List creatures registered in the live Fantasy Statblocks bestiary. source=notes returns creatures defined by note frontmatter (statblock: true); these are EPHEMERAL - held in memory keyed by note path and never written to the plugin data file, so an empty "monsters" array there proves nothing. source=srd returns the bundled SRD creatures; omit source for both. These are summaries only; use vtt_get_creature for one creature in full.',
        args: {
          source: { type: 'string', optional: true, description: 'Filter to "notes" (frontmatter creatures) or "srd" (bundled creatures). Omit for both.' },
          nameContains: { type: 'string', optional: true, description: 'Case-insensitive substring match against creature names.' },
          limit: { type: 'number', optional: true, description: 'Maximum number of creatures to return.' },
        },
        run: (args: any) => bridge.readBestiary({
          source: args.source,
          nameContains: args.nameContains,
          limit: args.limit,
        }),
        readOnly: true,
      },
      {
        name: 'vtt_get_creature',
        description:
          'Read one creature from the live Fantasy Statblocks bestiary by exact name, including note-registered creatures from frontmatter. Returns the full creature record as the plugin holds it in memory.',
        args: {
          name: { type: 'string', description: 'Exact creature name as it appears in the bestiary (see vtt_list_bestiary).' },
        },
        run: (args: any) => bridge.getBestiaryCreature({ name: args.name }),
        readOnly: true,
      },
      {
        name: 'vtt_get_settings',
        description:
          'Read the complete Atlas VTT settings object, including which player-window widgets, grid and initiative options are enabled. With "key" (dot path like "localPlayerView.showGrid") returns only that value. Prefer this over reading atlas-vtt/.atlas-data/settings.json directly: the plugin keeps settings in memory and rewrites the file.',
        args: {
          key: { type: 'string', optional: true, description: 'Optional setting key; use a dot path for nested settings, e.g. "localPlayerView.showGrid".' },
        },
        run: (args: any) => bridge.getSettings({ key: args.key }),
        readOnly: true,
      },
      {
        name: 'vtt_set_setting',
        description:
          'Change one Atlas VTT setting through Atlas\'s own settings service so the change takes effect live and persists correctly. The key must already exist in the settings object (dot path for nested settings, e.g. "localPlayerView.showGrid"); unknown keys are refused instead of silently creating junk settings. Returns the before and after values.',
        args: {
          key: { type: 'string', description: 'Existing settings key; dot path for nested settings, e.g. "localPlayerView.showGrid".' },
          value: { type: 'json', description: 'New value: string, number, boolean or object, matching the type of the current value.' },
        },
        run: (args: any) => bridge.setSetting({ key: args.key, value: args.value }),
        readOnly: false,
      },
      {
        name: 'vtt_show_player_image',
        description:
          'Show an image on the Atlas VTT player window - the "reveal to the players" action (a map excerpt, a handout, a portrait). The path must be an existing vault file; vtt_list_assets returns ready-to-use paths. Requires the Atlas PLAYER WINDOW to be open already: it mirrors a loaded map and is opened via vtt_execute_command with "atlas-vtt:send-map-to-player-view" (or from the Atlas UI). If it is not open, Atlas accepts the call but displays nothing - check with vtt_player_image_status.',
        args: {
          path: { type: 'string', description: 'Vault-relative path of an image file, e.g. "atlas-vtt/assets/Cleric_xxx.webp".' },
        },
        run: (args: any) => bridge.showImageOnPlayerView({ path: args.path }),
        readOnly: false,
      },
      {
        name: 'vtt_player_image_status',
        description:
          'Report whether the Atlas player window is currently showing an image. Call after vtt_show_player_image to confirm the image actually mounted, and before dismissing.',
        run: () => bridge.playerImageStatus(),
        readOnly: true,
      },
      {
        name: 'vtt_dismiss_player_image',
        description: 'Close whatever image the Atlas player window is currently showing, returning players to the map.',
        run: () => bridge.dismissPlayerImage(),
        readOnly: false,
      },
      {
        name: 'vtt_execute_command',
        description:
          'Run a command from one of the three tabletop plugins (ids starting with "atlas-vtt:", "obsidian-5e-statblocks:" or "fantasy-content-generator:"). These are the UI-only actions that have no data API: player-window and panel toggles (send map to player view, dice log, initiative tracker, loot roller), opening the dashboard or creature view, importing statblock tokens. A registered command whose availability check refuses reports executed:false with a note, not an error. For general Obsidian commands use the Local REST API\'s own command tools.',
        args: {
          commandId: { type: 'string', description: 'Full command id, e.g. "atlas-vtt:send-map-to-player-view".' },
        },
        run: (args: any) => bridge.executeTabletopCommand({ commandId: args.commandId }),
        readOnly: false,
      },
    ];

    for (const tool of tools) {
      const shape = this.toolShape(tool.args);
      const parameterized = Object.keys(shape).length > 0;
      try {
        const off = api.addMcpTool(
          tool.name,
          tool.description,
          shape,
          async function (args: any) { return tool.run(args || {}); },
          { readOnlyHint: Boolean(tool.readOnly) },
        );
        if (typeof off === 'function') this.mcpCleanups.push(off);
        this.registeredTools.push(tool.name);
        if (parameterized) {
          this.parameterizedTools.push(tool.name);
          this.diagnostics.mcpArgumentChannel = 'zodish';
        }
      } catch (err) {
        // Degrade, do not die: if the typed registration was rejected, retry
        // parameterless so at least the unfiltered read stays available, and
        // record exactly what failed.
        this.diagnostics.errors.push({ where: 'addMcpTool:' + tool.name, error: this.describe(err) });
        if (!parameterized) continue;
        try {
          const off = api.addMcpTool(
            tool.name,
            tool.description + ' (Arguments are NOT accepted by this bridge build; use the REST routes for arguments.)',
            {},
            async function () { return tool.run({}); },
            { readOnlyHint: Boolean(tool.readOnly) },
          );
          if (typeof off === 'function') this.mcpCleanups.push(off);
          this.registeredTools.push(tool.name);
        } catch (err2) {
          this.diagnostics.errors.push({ where: 'addMcpTool:fallback:' + tool.name, error: this.describe(err2) });
        }
      }
    }
  }

  // =====================================================================
  // Host helpers
  // =====================================================================

  private plugin(id: string): any {
    try {
      const plugins: any = (this.app as any).plugins && (this.app as any).plugins.plugins;
      return plugins ? plugins[id] || null : null;
    } catch (err) { return null; }
  }

  /** Resolve an Atlas service by name at call time, never at load time. */
  private atlasService(name: string): any {
    const atlas = this.plugin(ATLAS_PLUGIN_ID);
    if (!atlas) return null;
    const svc = (atlas as any)[name];
    if (!svc || (typeof svc !== 'object' && typeof svc !== 'function')) return null;
    return svc;
  }

  /** Resolve a possibly dotted key against a settings object. */
  private resolveSettingKey(obj: any, key: string): any {
    if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)) {
      return { found: true, value: obj[key] };
    }
    const parts = String(key).split('.');
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) {
        return { found: false };
      }
      cur = cur[part];
    }
    return { found: true, value: cur };
  }

  /** Write a possibly dotted key into a plain object copy. */
  private setNestedKey(root: any, key: string, value: any): boolean {
    if (Object.prototype.hasOwnProperty.call(root, key)) {
      root[key] = value;
      return true;
    }
    const parts = String(key).split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, parts[i])) return false;
      cur = cur[parts[i]];
    }
    if (!cur || typeof cur !== 'object') return false;
    cur[parts[parts.length - 1]] = value;
    return true;
  }

  // =====================================================================
  // Fantasy Statblocks bestiary
  // =====================================================================

  /**
   * Fantasy Statblocks publishes its API as `window.FantasyStatblocks` and
   * deletes it again on unload.
   *
   * This is the ONLY way to see frontmatter-defined creatures. They are
   * EPHEMERAL: the plugin merges them into an in-memory registry keyed by note
   * path and never writes them into data.json's `monsters` array, which holds
   * only creatures imported through the UI. Reading data.json therefore cannot
   * tell you whether a creature note registered - a trap worth naming, since
   * the empty `monsters` array looks exactly like a failure.
   */
  private statblocksApi(): any {
    try {
      const api = typeof window !== 'undefined' ? (window as any).FantasyStatblocks : null;
      return api && typeof api === 'object' ? api : null;
    } catch (err) { return null; }
  }

  /** Shared preflight: returns { api, available, resolved } or an error object. */
  private bestiaryPreflight(): any {
    const api = this.statblocksApi();
    if (!api) {
      return {
        error: {
          ok: false,
          error: 'Fantasy Statblocks API unavailable (window.FantasyStatblocks is not set).',
          hint: 'The Fantasy Statblocks plugin must be enabled.',
        },
      };
    }
    const methodNames = ['getBestiaryNames', 'getBestiaryCreatures', 'hasCreature', 'getCreatureFromBestiary'];
    const available: any = {};
    for (const m of methodNames) available[m] = typeof api[m] === 'function';
    let resolved: any;
    try { resolved = typeof api.isResolved === 'function' ? Boolean(api.isResolved()) : undefined; }
    catch (err) { resolved = undefined; }
    if (resolved === false) {
      return {
        error: {
          ok: false,
          resolved: false,
          api: available,
          error: 'Bestiary is still resolving; frontmatter creature notes are not merged yet.',
          hint: 'Retry shortly, or run the "Fantasy Statblocks: Parse Frontmatter for Creatures" command.',
        },
      };
    }
    return { api, available, resolved };
  }

  /**
   * Read the live bestiary. Deliberately synchronous: the sync accessor throws
   * while the bestiary is still resolving, whereas the async one can leave a
   * caller waiting on a promise that never settles. We would rather report
   * "not resolved yet" than hang the request.
   */
  private readBestiary(args: any): any {
    const opts = args || {};
    const pre = this.bestiaryPreflight();
    if (pre.error) return pre.error;
    const { api, available, resolved } = pre;

    const readOne = (name: string): any => {
      try {
        return typeof api.getCreatureFromBestiary === 'function' ? api.getCreatureFromBestiary(name) : null;
      } catch (err) { return null; }
    };

    if (opts.name) {
      let exists = true;
      try { if (typeof api.hasCreature === 'function') exists = Boolean(api.hasCreature(opts.name)); }
      catch (err) { exists = true; }
      if (!exists) {
        return { ok: false, resolved, api: available, error: 'No such creature in the bestiary: ' + opts.name };
      }
      return { ok: true, resolved, api: available, creature: this.summarizeCreature(readOne(opts.name), opts.name) };
    }

    let names: string[] = [];
    try {
      if (typeof api.getBestiaryNames === 'function') {
        names = api.getBestiaryNames() || [];
      } else if (typeof api.getBestiaryCreatures === 'function') {
        names = (api.getBestiaryCreatures() || []).map((c: any) => c && c.name).filter(Boolean);
      }
    } catch (err) {
      return { ok: false, resolved, api: available, error: 'Could not enumerate the bestiary: ' + this.describe(err) };
    }

    let creatures = names.map((n) => this.summarizeCreature(readOne(n), n));
    if (opts.source === 'notes') creatures = creatures.filter((c: any) => c.fromNote);
    else if (opts.source === 'srd') creatures = creatures.filter((c: any) => !c.fromNote);
    if (opts.nameContains) {
      const needle = String(opts.nameContains).toLowerCase();
      creatures = creatures.filter((c: any) => String(c.name || '').toLowerCase().indexOf(needle) !== -1);
    }

    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : undefined;
    return {
      ok: true,
      resolved,
      api: available,
      total: creatures.length,
      fromNotes: creatures.filter((c: any) => c.fromNote).length,
      returned: limit ? Math.min(limit, creatures.length) : creatures.length,
      creatures: limit ? creatures.slice(0, limit) : creatures,
    };
  }

  /** One creature in FULL (unsummarized): the fields needed to actually run it. */
  private getBestiaryCreature(args: any): any {
    const name = args && args.name;
    if (!name) return { ok: false, error: 'A "name" is required.' };
    const pre = this.bestiaryPreflight();
    if (pre.error) return pre.error;
    const { api, available, resolved } = pre;
    let exists = true;
    try { if (typeof api.hasCreature === 'function') exists = Boolean(api.hasCreature(name)); }
    catch (err) { exists = true; }
    if (!exists) return { ok: false, resolved, api: available, error: 'No such creature in the bestiary: ' + name };
    let creature: any = null;
    try { creature = typeof api.getCreatureFromBestiary === 'function' ? api.getCreatureFromBestiary(name) : null; }
    catch (err) { return { ok: false, resolved, api: available, error: 'getCreatureFromBestiary failed: ' + this.describe(err) }; }
    if (!creature) return { ok: false, resolved, api: available, error: 'The bestiary matched the name but returned no record.' };
    return { ok: true, resolved, api: available, creature };
  }

  /** Project a creature record down to the fields an agent actually needs. */
  private summarizeCreature(creature: any, fallbackName: string): any {
    if (!creature || typeof creature !== 'object') {
      return { name: fallbackName || null, note: 'creature record unavailable' };
    }
    return {
      name: creature.name || fallbackName || null,
      source: creature.source || null,
      // Present only for frontmatter creature notes.
      path: creature.path || null,
      fromNote: Boolean(creature.path),
      type: creature.type || null,
      size: creature.size || null,
      cr: creature.cr === undefined ? null : creature.cr,
      ac: creature.ac === undefined ? null : creature.ac,
      hp: creature.hp === undefined ? null : creature.hp,
    };
  }

  private async readJson(relPath: string): Promise<any> {
    return JSON.parse(await this.app.vault.adapter.read(relPath));
  }

  /** Parse a request body that may arrive as an object or as raw bytes. */
  private body(req: any): any {
    try {
      const raw = req && req.body;
      if (!raw) return {};
      if (typeof raw === 'object' && !(raw instanceof Uint8Array)) return raw;
      const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
      return text ? JSON.parse(text) : {};
    } catch (err) {
      return {};
    }
  }

  private send(res: any, payload: any): void {
    try {
      res.status(200).json(payload);
    } catch (err) {
      try { res.status(500).json({ ok: false, error: this.describe(err) }); } catch (e) { /* ignore */ }
    }
  }

  private describe(err: any): string {
    if (!err) return 'unknown error';
    return (err.name ? err.name + ': ' : '') + (err.message || String(err));
  }

  private className(v: any): string {
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      const c = v.constructor;
      return (c && c.name) || typeof v;
    } catch (e) { return 'unknown'; }
  }

  // =====================================================================
  // Capabilities
  // =====================================================================

  private capabilities(): any {
    const atlas = this.plugin(ATLAS_PLUGIN_ID);
    const statblocks = this.plugin(STATBLOCKS_PLUGIN_ID);
    const generator = this.plugin(GENERATOR_PLUGIN_ID);

    const pluginReport = (id: string, instance: any) => instance
      ? { present: true, version: instance.manifest && instance.manifest.version }
      : { present: false, id };

    const services: any = {};
    if (atlas) {
      for (const key of Object.keys(atlas)) {
        const v = (atlas as any)[key];
        if (v && typeof v === 'object' && typeof v.then !== 'function') services[key] = this.className(v);
      }
    }

    return {
      ok: true,
      bridge: { id: this.manifest.id, name: this.manifest.name, version: this.manifest.version },
      extensionApiVersion: this.api && this.api.apiVersion,
      plugins: {
        'atlas-vtt': pluginReport(ATLAS_PLUGIN_ID, atlas),
        'obsidian-5e-statblocks': pluginReport(STATBLOCKS_PLUGIN_ID, statblocks),
        'fantasy-content-generator': pluginReport(GENERATOR_PLUGIN_ID, generator),
      },
      atlasServices: services,
      capabilities: {
        readAssetLibrary: true,
        readAndWriteSettings: Boolean(this.atlasService('settingsService')),
        playerViewImage: Boolean(this.atlasService('imageDisplayService')),
        tabletopCommands: true,
        readBestiary: Boolean(this.statblocksApi()),
      },
      statblocksApi: (() => {
        const api = this.statblocksApi();
        if (!api) return { available: false };
        const methods: any = {};
        for (const m of ['getBestiaryNames', 'getBestiaryCreatures', 'hasCreature', 'getCreature', 'getCreatureFromBestiary', 'isResolved']) {
          methods[m] = typeof api[m] === 'function';
        }
        let resolved: any;
        try { resolved = typeof api.isResolved === 'function' ? Boolean(api.isResolved()) : undefined; }
        catch (err) { resolved = undefined; }
        return { available: true, resolved, methods };
      })(),
      mcp: {
        argumentChannel: this.diagnostics.mcpArgumentChannel,
        tools: this.registeredTools,
        parameterizedTools: this.parameterizedTools,
      },
      restRoutes: {
        base: '/vault/<any-note>/' + ROUTE_PREFIX + '/',
        endpoints: [
          'GET  capabilities',
          'GET  collections',
          'GET  assets?collection=&type=&nameContains=&limit=',
          'GET  bestiary?name=&source=notes|srd&nameContains=&limit=',
          'GET  settings?key=   (key may be a dot path, e.g. localPlayerView.showGrid)',
          'POST settings                     {key, value}  (key must already exist)',
          'GET  player-image',
          'POST player-image                 {path}',
          'DELETE player-image               (or POST player-image/dismiss)',
          'POST command                      {commandId}',
        ],
      },
      registeredMcpTools: this.registeredTools.filter((t) => typeof t === 'string'),
      diagnostics: this.diagnostics,
    };
  }

  // =====================================================================
  // Asset library (read-only, from Atlas's metadata store)
  // =====================================================================

  private async listAssets(args: any): Promise<any> {
    args = args || {};
    let data: any;
    try {
      data = await this.readJson(ATLAS_ASSETS_PATH);
    } catch (err) {
      return { ok: false, error: 'Could not read Atlas asset metadata: ' + this.describe(err), path: ATLAS_ASSETS_PATH };
    }
    const all = data && data.assets
      ? Object.keys(data.assets).map((k) => Object.assign({ id: k }, data.assets[k]))
      : [];
    let items = all;
    if (args.collection) items = items.filter((a: any) => a.collection === args.collection);
    if (args.type) items = items.filter((a: any) => a.type === args.type);
    if (args.nameContains) {
      const needle = String(args.nameContains).toLowerCase();
      items = items.filter((a: any) => String(a.name || '').toLowerCase().indexOf(needle) >= 0);
    }
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 200;
    const trimmed = items.slice(0, limit).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      collection: a.collection,
      imagePath: a.imagePath,
      tags: a.tags,
      modifiedAt: a.modifiedAt,
    }));
    return { ok: true, total: all.length, matched: items.length, returned: trimmed.length, assets: trimmed };
  }

  private async listCollections(): Promise<any> {
    let data: any;
    try {
      data = await this.readJson(ATLAS_ASSETS_PATH);
    } catch (err) {
      return { ok: false, error: 'Could not read Atlas asset metadata: ' + this.describe(err) };
    }
    const collectionsRaw = (data && data.collections) || {};
    const assets = (data && data.assets) || {};
    const counts: any = {};
    for (const key of Object.keys(assets)) {
      const c = assets[key] && assets[key].collection;
      if (c) counts[c] = (counts[c] || 0) + 1;
    }
    const collections = Object.keys(collectionsRaw).map((k) => {
      const c = collectionsRaw[k] || {};
      const id = c.id || k;
      return { id, name: c.name, description: c.description, uid: c.uid, assetCount: counts[id] || 0 };
    });
    return { ok: true, defaultCollectionId: data && data.defaultCollectionId, collections };
  }

  // =====================================================================
  // Settings (through Atlas's own service, so changes persist correctly)
  // =====================================================================

  private async getSettings(args: any): Promise<any> {
    args = args || {};
    const svc = this.atlasService('settingsService');
    if (svc && typeof svc.getAllSettings === 'function') {
      try {
        const all = svc.getAllSettings();
        if (args.key) {
          const hit = this.resolveSettingKey(all || {}, args.key);
          if (!hit.found) {
            return {
              ok: false,
              source: 'settingsService',
              key: args.key,
              error: 'No such setting key: ' + args.key,
              knownKeys: Object.keys(all || {}),
              hint: 'Nested settings need a dot path, e.g. "localPlayerView.showGrid".',
            };
          }
          return { ok: true, source: 'settingsService', key: args.key, value: hit.value };
        }
        return { ok: true, source: 'settingsService', settings: all };
      } catch (err) {
        return { ok: false, error: 'settingsService.getAllSettings failed: ' + this.describe(err) };
      }
    }
    try {
      const all = await this.readJson(ATLAS_SETTINGS_PATH);
      if (args.key) {
        const hit = this.resolveSettingKey(all || {}, args.key);
        if (!hit.found) return { ok: false, source: 'file', key: args.key, error: 'No such setting key: ' + args.key };
        return { ok: true, source: 'file', key: args.key, value: hit.value };
      }
      return { ok: true, source: 'file', settings: all };
    } catch (err) {
      return { ok: false, error: 'Could not read Atlas settings: ' + this.describe(err) };
    }
  }

  private async setSetting(args: any): Promise<any> {
    if (!args || !args.key) return { ok: false, error: 'A "key" is required.' };
    const svc = this.atlasService('settingsService');
    if (!svc || typeof svc.setSetting !== 'function') {
      return {
        ok: false,
        error: 'Atlas settings service unavailable; refusing to write behind the plugin\'s back.',
      };
    }
    // Guard against junk settings: an unknown key used to be created silently
    // (a typo'd POST wrote __junk__: 42 straight into the settings).
    try {
      const current = typeof svc.getAllSettings === 'function' ? svc.getAllSettings() : await this.readJson(ATLAS_SETTINGS_PATH);
      const probe = this.resolveSettingKey(current || {}, args.key);
      if (!probe.found) {
        return {
          ok: false,
          key: args.key,
          error: 'Unknown settings key: ' + args.key,
          knownKeys: Object.keys(current || {}),
          hint: 'The key must already exist. Nested settings need a dot path, e.g. "localPlayerView.showGrid".',
        };
      }
      const before = probe.value;
      try {
        svc.setSetting(args.key, args.value);
      } catch (err) {
        // Some settings services only understand top-level keys. If the dotted
        // write was refused, replace the containing root object wholesale.
        if (!String(args.key).includes('.')) throw err;
        const rootKey = String(args.key).split('.')[0];
        const copy = JSON.parse(JSON.stringify(current[rootKey]));
        if (!this.setNestedKey(copy, String(args.key).slice(rootKey.length + 1), args.value)) throw err;
        svc.setSetting(rootKey, copy);
      }
      const afterAll = typeof svc.getAllSettings === 'function' ? svc.getAllSettings() : current;
      const after = this.resolveSettingKey(afterAll || {}, args.key);
      return { ok: true, key: args.key, before, after: after.found ? after.value : undefined, applied: after.found };
    } catch (err) {
      return { ok: false, error: 'settingsService.setSetting failed: ' + this.describe(err) };
    }
  }

  // =====================================================================
  // Player window image (the reveal / hand-out action)
  // =====================================================================

  private async playerImageStatus(): Promise<any> {
    const svc = this.atlasService('imageDisplayService');
    if (!svc || typeof svc.isImageDisplayed !== 'function') {
      return { ok: false, error: 'Atlas image display service unavailable.' };
    }
    try {
      return { ok: true, isImageDisplayed: Boolean(svc.isImageDisplayed()) };
    } catch (err) {
      return { ok: false, error: 'isImageDisplayed failed: ' + this.describe(err) };
    }
  }

  private async showImageOnPlayerView(args: any): Promise<any> {
    if (!args || !args.path) return { ok: false, error: 'A "path" is required.' };
    const svc = this.atlasService('imageDisplayService');
    if (!svc || typeof svc.displayImageOnPlayerView !== 'function') {
      return { ok: false, error: 'Atlas image display service unavailable.' };
    }
    const cleaned = String(args.path).replace(/^\/+/, '');
    const file = this.app.vault.getAbstractFileByPath(cleaned);
    if (!file) return { ok: false, error: 'No vault file at path: ' + cleaned };

    const attempts: any[] = [];
    for (const candidate of [file, cleaned]) {
      const kind = candidate === file ? 'TFile' : 'string';
      try {
        await svc.displayImageOnPlayerView(candidate);
        // isImageDisplayed can read false for a moment after a successful
        // call - the display is set up asynchronously. Wait briefly and
        // re-check so the reported status is trustworthy.
        const immediate = typeof svc.isImageDisplayed === 'function' ? Boolean(svc.isImageDisplayed()) : undefined;
        await new Promise((resolve) => setTimeout(resolve, 400));
        const settled = typeof svc.isImageDisplayed === 'function' ? Boolean(svc.isImageDisplayed()) : undefined;
        const out: any = { ok: true, path: cleaned, acceptedArgument: kind, isImageDisplayed: settled };
        if (immediate === false && settled !== true) {
          out.note =
            'displayImageOnPlayerView returned without displaying: the Atlas player window is not open. ' +
            'Atlas opens it from a LOADED MAP via vtt_execute_command with commandId "atlas-vtt:send-map-to-player-view". ' +
            'Without a player window Atlas only shows a notice and keeps the image unmounted; this call cannot be trusted until one exists.';
          out.ok = false;
          out.error = 'Player window not open; image was not displayed.';
        }
        return out;
      } catch (err) {
        attempts.push({ kind, error: this.describe(err) });
      }
    }
    return { ok: false, path: cleaned, error: 'Atlas rejected every argument shape tried.', attempts };
  }

  private async dismissPlayerImage(): Promise<any> {
    const svc = this.atlasService('imageDisplayService');
    if (!svc || typeof svc.closeImageDisplay !== 'function') {
      return { ok: false, error: 'Atlas image display service unavailable.' };
    }
    try {
      const wasDisplayed = typeof svc.isImageDisplayed === 'function' ? Boolean(svc.isImageDisplayed()) : undefined;
      svc.closeImageDisplay();
      return { ok: true, wasDisplayed };
    } catch (err) {
      return { ok: false, error: 'closeImageDisplay failed: ' + this.describe(err) };
    }
  }

  // =====================================================================
  // Commands (UI-only actions), restricted to the tabletop plugins
  // =====================================================================

  private async executeTabletopCommand(args: any): Promise<any> {
    const id = args && args.commandId;
    if (!id) return { ok: false, error: 'A "commandId" is required.' };
    if (!TABLETOP_COMMAND_PREFIXES.some((p) => String(id).indexOf(p) === 0)) {
      return {
        ok: false,
        error: 'Refused: this bridge runs only tabletop plugin commands.',
        allowedPrefixes: TABLETOP_COMMAND_PREFIXES,
        hint: 'Use the Local REST API plugin\'s own command tools for general Obsidian commands.',
      };
    }
    const commands: any = (this.app as any).commands;
    if (!commands || typeof commands.executeCommandById !== 'function') {
      return { ok: false, error: 'Obsidian command API unavailable.' };
    }
    // Resolve against the RAW command registry - the same map that
    // executeCommandById() itself consults.
    //
    // Do NOT gate on commands.listCommands(). That returns only the commands
    // Obsidian considers available in the CURRENT context, so it silently
    // omits every command whose checkCallback(false) is false right now. The
    // Atlas VTT panel toggles are exactly that shape: they are registered at
    // all times but report unavailable while no tabletop view is open. Gating
    // on the filter answered "No such command" for commands that exist and
    // execute perfectly - a lie the caller cannot detect.
    const registry = commands.commands;
    if (registry && typeof registry === 'object' && !(id in registry)) {
      return { ok: false, error: 'No such command: ' + id };
    }
    try {
      const result = commands.executeCommandById(id);
      const executed = result !== false;
      const outcome: any = { ok: true, commandId: id, executed };
      if (!executed) {
        // The command exists but its own availability check refused to run.
        // Report that distinctly instead of implying the id was unknown.
        outcome.note =
          'Command is registered but declined to run in the current context ' +
          '(its availability check returned false). Open the view it needs, then retry.';
      }
      return outcome;
    } catch (err) {
      return { ok: false, commandId: id, error: this.describe(err) };
    }
  }

  private cleanupMcp(): void {
    for (const off of this.mcpCleanups) {
      try { off(); } catch (e) { /* ignore */ }
    }
    this.mcpCleanups = [];
    this.registeredTools = [];
    this.parameterizedTools = [];
    this.registered = false;
  }

  onunload() {
    this.cleanupMcp();
  }
}
