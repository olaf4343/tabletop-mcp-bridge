/*
Tabletop MCP Bridge - generated/bundled by esbuild.
Source lives in src/. Provenance and history: see CHANGELOG.md.
*/

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TabletopMcpBridge
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var REST_PLUGIN_ID = "obsidian-local-rest-api";
var ATLAS_PLUGIN_ID = "atlas-vtt";
var STATBLOCKS_PLUGIN_ID = "obsidian-5e-statblocks";
var GENERATOR_PLUGIN_ID = "fantasy-content-generator";
var ROUTE_PREFIX = "vtt-bridge";
var ATLAS_ASSETS_PATH = "atlas-vtt/.atlas-data/assets-metadata.json";
var ATLAS_SETTINGS_PATH = "atlas-vtt/.atlas-data/settings.json";
var TABLETOP_COMMAND_PREFIXES = ["atlas-vtt:", "obsidian-5e-statblocks:", "fantasy-content-generator:"];
var TabletopMcpBridge = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.api = null;
    this.registered = false;
    this.registeredTools = [];
    this.parameterizedTools = [];
    this.mcpCleanups = [];
    this.diagnostics = { loadedAt: (/* @__PURE__ */ new Date()).toISOString(), errors: [], mcpArgumentChannel: "none" };
    this.restRetryScheduled = false;
  }
  async onload() {
    this.diagnostics = { loadedAt: (/* @__PURE__ */ new Date()).toISOString(), errors: [], mcpArgumentChannel: "none" };
    const api = this.getRestApi();
    if (api) {
      this.api = api;
      this.registerAll();
    } else {
      this.diagnostics.unavailable = "obsidian-local-rest-api is not reachable";
      this.attemptRestRecovery();
    }
    this.register(() => () => this.cleanupMcp());
  }
  registerAll() {
    if (this.registered)
      return;
    this.registered = true;
    this.registerSubresourceRoutes(this.api);
    this.registerMcpTools(this.api);
    try {
      new import_obsidian.Notice("Tabletop MCP Bridge: " + this.registeredTools.length + " tools (" + this.parameterizedTools.length + " typed), REST routes at /vault/<note>/" + ROUTE_PREFIX + "/");
    } catch (e) {
    }
  }
  /**
   * The most common setup failure is load order: this plugin loading before
   * the Local REST API is enabled. Try to enable it if it is installed but
   * off, retry registration once shortly, and only then report the missing
   * dependency.
   */
  attemptRestRecovery() {
    if (this.restRetryScheduled)
      return;
    this.restRetryScheduled = true;
    try {
      const pm = this.app.plugins;
      const manifest = pm && pm.manifests && pm.manifests[REST_PLUGIN_ID];
      if (manifest && pm.enabledPlugins && !pm.enabledPlugins.has(REST_PLUGIN_ID) && typeof pm.enablePlugin === "function") {
        this.diagnostics.restRecovery = "attempting to enable " + REST_PLUGIN_ID;
        void pm.enablePlugin(REST_PLUGIN_ID);
      }
    } catch (e) {
    }
    setTimeout(() => {
      if (this.registered)
        return;
      const api = this.getRestApi();
      if (api) {
        this.api = api;
        this.diagnostics.restRecovery = "enabled and registered on retry";
        this.registerAll();
      } else {
        try {
          new import_obsidian.Notice('Tabletop MCP Bridge: please install and enable the "Local REST API with MCP" community plugin first.');
        } catch (e) {
        }
      }
    }, 1500);
  }
  // =====================================================================
  // Registration
  // =====================================================================
  getRestApi() {
    try {
      const plugins = this.app.plugins && this.app.plugins.plugins;
      if (!plugins)
        return null;
      const plugin = plugins[REST_PLUGIN_ID];
      if (!plugin || typeof plugin.getPublicApi !== "function")
        return null;
      return plugin.getPublicApi(this.manifest) || null;
    } catch (err) {
      this.diagnostics.errors.push({ where: "getPublicApi", error: this.describe(err) });
      return null;
    }
  }
  /**
   * The parameterized half of the bridge: one authenticated Express router,
   * mounted under every note, exposing every operation over plain REST.
   */
  registerSubresourceRoutes(api) {
    let router;
    try {
      router = api.addVaultSubresource(ROUTE_PREFIX);
    } catch (err) {
      this.diagnostics.errors.push({ where: "addVaultSubresource", error: this.describe(err) });
      return;
    }
    if (!router || typeof router.get !== "function") {
      this.diagnostics.errors.push({ where: "addVaultSubresource", error: "no router returned" });
      return;
    }
    const bridge = this;
    router.get("/capabilities", async (_req, res) => this.send(res, await bridge.capabilities()));
    router.get("/collections", async (_req, res) => this.send(res, await bridge.listCollections()));
    router.get("/assets", async (req, res) => {
      this.send(res, await bridge.listAssets({
        collection: req.query.collection,
        type: req.query.type,
        nameContains: req.query.nameContains,
        limit: req.query.limit ? Number(req.query.limit) : void 0
      }));
    });
    router.get("/bestiary", async (req, res) => {
      this.send(res, bridge.readBestiary({
        name: req.query.name,
        source: req.query.source,
        nameContains: req.query.nameContains,
        limit: req.query.limit ? Number(req.query.limit) : void 0
      }));
    });
    router.get("/settings", async (req, res) => this.send(res, await bridge.getSettings({ key: req.query.key })));
    router.post("/settings", async (req, res) => {
      const body = this.body(req);
      this.send(res, await bridge.setSetting({ key: body.key, value: body.value }));
    });
    router.get("/player-image", async (_req, res) => this.send(res, await bridge.playerImageStatus()));
    router.post("/player-image", async (req, res) => {
      const body = this.body(req);
      this.send(res, await bridge.showImageOnPlayerView({ path: body.path }));
    });
    router.delete("/player-image", async (_req, res) => this.send(res, await bridge.dismissPlayerImage()));
    router.post("/player-image/dismiss", async (_req, res) => this.send(res, await bridge.dismissPlayerImage()));
    router.post("/command", async (req, res) => {
      const body = this.body(req);
      this.send(res, await bridge.executeTabletopCommand({ commandId: body.commandId }));
    });
    this.diagnostics.routesMounted = true;
  }
  /**
   * A hand-built validator the host's bundled Zod v3 accepts (see header).
   * `type` is one of: string | number | boolean | json.
   */
  zodish(type, description, opts) {
    const typeNameByType = { string: "ZodString", number: "ZodNumber", boolean: "ZodBoolean", json: "ZodAny" };
    const zodTypeName = typeNameByType[type] || "ZodAny";
    const def = { typeName: zodTypeName };
    if (description)
      def.description = description;
    if (opts && opts.optional) {
      return {
        _def: { typeName: "ZodOptional", innerType: { _def: def } },
        isOptional: () => true,
        _parse: (input) => ({ status: "valid", value: input.data })
      };
    }
    return {
      _def: def,
      isOptional: () => false,
      _parse: (input) => ({ status: "valid", value: input.data })
    };
  }
  /** Build a Zod raw shape from a plain spec: { arg: { type, description, optional } }. */
  toolShape(spec) {
    const shape = {};
    for (const name of Object.keys(spec || {})) {
      const arg = spec[name];
      shape[name] = this.zodish(arg.type, arg.description, { optional: Boolean(arg.optional) });
    }
    return shape;
  }
  registerMcpTools(api) {
    const bridge = this;
    const tools = [
      {
        name: "vtt_capabilities",
        description: "Report which Obsidian tabletop plugins the Tabletop MCP Bridge can reach, which Atlas VTT runtime services are available, and which bridge features are active. Call this first if another tool returns something unexpected, or after upgrading a plugin, to see what changed.",
        run: () => bridge.capabilities(),
        readOnly: true
      },
      {
        name: "vtt_list_collections",
        description: "List Atlas VTT asset collections with id, name, description, uid and asset counts.",
        run: () => bridge.listCollections(),
        readOnly: true
      },
      {
        name: "vtt_list_assets",
        description: "List assets registered in the Atlas VTT asset library (tokens, maps and other images) with image path, collection and tags. Call this to discover what art exists before adding tokens to a map or showing an image on the player window. All arguments are optional filters; with no arguments every asset is returned (up to 200).",
        args: {
          nameContains: { type: "string", optional: true, description: "Case-insensitive substring match against the asset name." },
          type: { type: "string", optional: true, description: 'Exact asset type filter, e.g. "token" or "map".' },
          collection: { type: "string", optional: true, description: 'Exact collection id, e.g. "Default".' },
          limit: { type: "number", optional: true, description: "Maximum number of assets to return (default 200)." }
        },
        run: (args) => bridge.listAssets({
          collection: args.collection,
          type: args.type,
          nameContains: args.nameContains,
          limit: args.limit
        }),
        readOnly: true
      },
      {
        name: "vtt_list_bestiary",
        description: 'List creatures registered in the live Fantasy Statblocks bestiary. source=notes returns creatures defined by note frontmatter (statblock: true); these are EPHEMERAL - held in memory keyed by note path and never written to the plugin data file, so an empty "monsters" array there proves nothing. source=srd returns the bundled SRD creatures; omit source for both. These are summaries only; use vtt_get_creature for one creature in full.',
        args: {
          source: { type: "string", optional: true, description: 'Filter to "notes" (frontmatter creatures) or "srd" (bundled creatures). Omit for both.' },
          nameContains: { type: "string", optional: true, description: "Case-insensitive substring match against creature names." },
          limit: { type: "number", optional: true, description: "Maximum number of creatures to return." }
        },
        run: (args) => bridge.readBestiary({
          source: args.source,
          nameContains: args.nameContains,
          limit: args.limit
        }),
        readOnly: true
      },
      {
        name: "vtt_get_creature",
        description: "Read one creature from the live Fantasy Statblocks bestiary by exact name, including note-registered creatures from frontmatter. Returns the full creature record as the plugin holds it in memory.",
        args: {
          name: { type: "string", description: "Exact creature name as it appears in the bestiary (see vtt_list_bestiary)." }
        },
        run: (args) => bridge.getBestiaryCreature({ name: args.name }),
        readOnly: true
      },
      {
        name: "vtt_get_settings",
        description: 'Read the complete Atlas VTT settings object, including which player-window widgets, grid and initiative options are enabled. With "key" (dot path like "localPlayerView.showGrid") returns only that value. Prefer this over reading atlas-vtt/.atlas-data/settings.json directly: the plugin keeps settings in memory and rewrites the file.',
        args: {
          key: { type: "string", optional: true, description: 'Optional setting key; use a dot path for nested settings, e.g. "localPlayerView.showGrid".' }
        },
        run: (args) => bridge.getSettings({ key: args.key }),
        readOnly: true
      },
      {
        name: "vtt_set_setting",
        description: `Change one Atlas VTT setting through Atlas's own settings service so the change takes effect live and persists correctly. The key must already exist in the settings object (dot path for nested settings, e.g. "localPlayerView.showGrid"); unknown keys are refused instead of silently creating junk settings. Returns the before and after values.`,
        args: {
          key: { type: "string", description: 'Existing settings key; dot path for nested settings, e.g. "localPlayerView.showGrid".' },
          value: { type: "json", description: "New value: string, number, boolean or object, matching the type of the current value." }
        },
        run: (args) => bridge.setSetting({ key: args.key, value: args.value }),
        readOnly: false
      },
      {
        name: "vtt_show_player_image",
        description: 'Show an image on the Atlas VTT player window - the "reveal to the players" action (a map excerpt, a handout, a portrait). The path must be an existing vault file; vtt_list_assets returns ready-to-use paths. Requires the Atlas PLAYER WINDOW to be open already: it mirrors a loaded map and is opened via vtt_execute_command with "atlas-vtt:send-map-to-player-view" (or from the Atlas UI). If it is not open, Atlas accepts the call but displays nothing - check with vtt_player_image_status.',
        args: {
          path: { type: "string", description: 'Vault-relative path of an image file, e.g. "atlas-vtt/assets/Cleric_xxx.webp".' }
        },
        run: (args) => bridge.showImageOnPlayerView({ path: args.path }),
        readOnly: false
      },
      {
        name: "vtt_player_image_status",
        description: "Report whether the Atlas player window is currently showing an image. Call after vtt_show_player_image to confirm the image actually mounted, and before dismissing.",
        run: () => bridge.playerImageStatus(),
        readOnly: true
      },
      {
        name: "vtt_dismiss_player_image",
        description: "Close whatever image the Atlas player window is currently showing, returning players to the map.",
        run: () => bridge.dismissPlayerImage(),
        readOnly: false
      },
      {
        name: "vtt_execute_command",
        description: `Run a command from one of the three tabletop plugins (ids starting with "atlas-vtt:", "obsidian-5e-statblocks:" or "fantasy-content-generator:"). These are the UI-only actions that have no data API: player-window and panel toggles (send map to player view, dice log, initiative tracker, loot roller), opening the dashboard or creature view, importing statblock tokens. A registered command whose availability check refuses reports executed:false with a note, not an error. For general Obsidian commands use the Local REST API's own command tools.`,
        args: {
          commandId: { type: "string", description: 'Full command id, e.g. "atlas-vtt:send-map-to-player-view".' }
        },
        run: (args) => bridge.executeTabletopCommand({ commandId: args.commandId }),
        readOnly: false
      }
    ];
    for (const tool of tools) {
      const shape = this.toolShape(tool.args);
      const parameterized = Object.keys(shape).length > 0;
      try {
        const off = api.addMcpTool(
          tool.name,
          tool.description,
          shape,
          async function(args) {
            return tool.run(args || {});
          },
          { readOnlyHint: Boolean(tool.readOnly) }
        );
        if (typeof off === "function")
          this.mcpCleanups.push(off);
        this.registeredTools.push(tool.name);
        if (parameterized) {
          this.parameterizedTools.push(tool.name);
          this.diagnostics.mcpArgumentChannel = "zodish";
        }
      } catch (err) {
        this.diagnostics.errors.push({ where: "addMcpTool:" + tool.name, error: this.describe(err) });
        if (!parameterized)
          continue;
        try {
          const off = api.addMcpTool(
            tool.name,
            tool.description + " (Arguments are NOT accepted by this bridge build; use the REST routes for arguments.)",
            {},
            async function() {
              return tool.run({});
            },
            { readOnlyHint: Boolean(tool.readOnly) }
          );
          if (typeof off === "function")
            this.mcpCleanups.push(off);
          this.registeredTools.push(tool.name);
        } catch (err2) {
          this.diagnostics.errors.push({ where: "addMcpTool:fallback:" + tool.name, error: this.describe(err2) });
        }
      }
    }
  }
  // =====================================================================
  // Host helpers
  // =====================================================================
  plugin(id) {
    try {
      const plugins = this.app.plugins && this.app.plugins.plugins;
      return plugins ? plugins[id] || null : null;
    } catch (err) {
      return null;
    }
  }
  /** Resolve an Atlas service by name at call time, never at load time. */
  atlasService(name) {
    const atlas = this.plugin(ATLAS_PLUGIN_ID);
    if (!atlas)
      return null;
    const svc = atlas[name];
    if (!svc || typeof svc !== "object" && typeof svc !== "function")
      return null;
    return svc;
  }
  /** Resolve a possibly dotted key against a settings object. */
  resolveSettingKey(obj, key) {
    if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key)) {
      return { found: true, value: obj[key] };
    }
    const parts = String(key).split(".");
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
        return { found: false };
      }
      cur = cur[part];
    }
    return { found: true, value: cur };
  }
  /** Write a possibly dotted key into a plain object copy. */
  setNestedKey(root, key, value) {
    if (Object.prototype.hasOwnProperty.call(root, key)) {
      root[key] = value;
      return true;
    }
    const parts = String(key).split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, parts[i]))
        return false;
      cur = cur[parts[i]];
    }
    if (!cur || typeof cur !== "object")
      return false;
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
  statblocksApi() {
    try {
      const api = typeof window !== "undefined" ? window.FantasyStatblocks : null;
      return api && typeof api === "object" ? api : null;
    } catch (err) {
      return null;
    }
  }
  /** Shared preflight: returns { api, available, resolved } or an error object. */
  bestiaryPreflight() {
    const api = this.statblocksApi();
    if (!api) {
      return {
        error: {
          ok: false,
          error: "Fantasy Statblocks API unavailable (window.FantasyStatblocks is not set).",
          hint: "The Fantasy Statblocks plugin must be enabled."
        }
      };
    }
    const methodNames = ["getBestiaryNames", "getBestiaryCreatures", "hasCreature", "getCreatureFromBestiary"];
    const available = {};
    for (const m of methodNames)
      available[m] = typeof api[m] === "function";
    let resolved;
    try {
      resolved = typeof api.isResolved === "function" ? Boolean(api.isResolved()) : void 0;
    } catch (err) {
      resolved = void 0;
    }
    if (resolved === false) {
      return {
        error: {
          ok: false,
          resolved: false,
          api: available,
          error: "Bestiary is still resolving; frontmatter creature notes are not merged yet.",
          hint: 'Retry shortly, or run the "Fantasy Statblocks: Parse Frontmatter for Creatures" command.'
        }
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
  readBestiary(args) {
    const opts = args || {};
    const pre = this.bestiaryPreflight();
    if (pre.error)
      return pre.error;
    const { api, available, resolved } = pre;
    const readOne = (name) => {
      try {
        return typeof api.getCreatureFromBestiary === "function" ? api.getCreatureFromBestiary(name) : null;
      } catch (err) {
        return null;
      }
    };
    if (opts.name) {
      let exists = true;
      try {
        if (typeof api.hasCreature === "function")
          exists = Boolean(api.hasCreature(opts.name));
      } catch (err) {
        exists = true;
      }
      if (!exists) {
        return { ok: false, resolved, api: available, error: "No such creature in the bestiary: " + opts.name };
      }
      return { ok: true, resolved, api: available, creature: this.summarizeCreature(readOne(opts.name), opts.name) };
    }
    let names = [];
    try {
      if (typeof api.getBestiaryNames === "function") {
        names = api.getBestiaryNames() || [];
      } else if (typeof api.getBestiaryCreatures === "function") {
        names = (api.getBestiaryCreatures() || []).map((c) => c && c.name).filter(Boolean);
      }
    } catch (err) {
      return { ok: false, resolved, api: available, error: "Could not enumerate the bestiary: " + this.describe(err) };
    }
    let creatures = names.map((n) => this.summarizeCreature(readOne(n), n));
    if (opts.source === "notes")
      creatures = creatures.filter((c) => c.fromNote);
    else if (opts.source === "srd")
      creatures = creatures.filter((c) => !c.fromNote);
    if (opts.nameContains) {
      const needle = String(opts.nameContains).toLowerCase();
      creatures = creatures.filter((c) => String(c.name || "").toLowerCase().indexOf(needle) !== -1);
    }
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : void 0;
    return {
      ok: true,
      resolved,
      api: available,
      total: creatures.length,
      fromNotes: creatures.filter((c) => c.fromNote).length,
      returned: limit ? Math.min(limit, creatures.length) : creatures.length,
      creatures: limit ? creatures.slice(0, limit) : creatures
    };
  }
  /** One creature in FULL (unsummarized): the fields needed to actually run it. */
  getBestiaryCreature(args) {
    const name = args && args.name;
    if (!name)
      return { ok: false, error: 'A "name" is required.' };
    const pre = this.bestiaryPreflight();
    if (pre.error)
      return pre.error;
    const { api, available, resolved } = pre;
    let exists = true;
    try {
      if (typeof api.hasCreature === "function")
        exists = Boolean(api.hasCreature(name));
    } catch (err) {
      exists = true;
    }
    if (!exists)
      return { ok: false, resolved, api: available, error: "No such creature in the bestiary: " + name };
    let creature = null;
    try {
      creature = typeof api.getCreatureFromBestiary === "function" ? api.getCreatureFromBestiary(name) : null;
    } catch (err) {
      return { ok: false, resolved, api: available, error: "getCreatureFromBestiary failed: " + this.describe(err) };
    }
    if (!creature)
      return { ok: false, resolved, api: available, error: "The bestiary matched the name but returned no record." };
    return { ok: true, resolved, api: available, creature };
  }
  /** Project a creature record down to the fields an agent actually needs. */
  summarizeCreature(creature, fallbackName) {
    if (!creature || typeof creature !== "object") {
      return { name: fallbackName || null, note: "creature record unavailable" };
    }
    return {
      name: creature.name || fallbackName || null,
      source: creature.source || null,
      // Present only for frontmatter creature notes.
      path: creature.path || null,
      fromNote: Boolean(creature.path),
      type: creature.type || null,
      size: creature.size || null,
      cr: creature.cr === void 0 ? null : creature.cr,
      ac: creature.ac === void 0 ? null : creature.ac,
      hp: creature.hp === void 0 ? null : creature.hp
    };
  }
  async readJson(relPath) {
    return JSON.parse(await this.app.vault.adapter.read(relPath));
  }
  /** Parse a request body that may arrive as an object or as raw bytes. */
  body(req) {
    try {
      const raw = req && req.body;
      if (!raw)
        return {};
      if (typeof raw === "object" && !(raw instanceof Uint8Array))
        return raw;
      const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
      return text ? JSON.parse(text) : {};
    } catch (err) {
      return {};
    }
  }
  send(res, payload) {
    try {
      res.status(200).json(payload);
    } catch (err) {
      try {
        res.status(500).json({ ok: false, error: this.describe(err) });
      } catch (e) {
      }
    }
  }
  describe(err) {
    if (!err)
      return "unknown error";
    return (err.name ? err.name + ": " : "") + (err.message || String(err));
  }
  className(v) {
    try {
      if (v === null)
        return "null";
      if (v === void 0)
        return "undefined";
      const c = v.constructor;
      return c && c.name || typeof v;
    } catch (e) {
      return "unknown";
    }
  }
  // =====================================================================
  // Capabilities
  // =====================================================================
  capabilities() {
    const atlas = this.plugin(ATLAS_PLUGIN_ID);
    const statblocks = this.plugin(STATBLOCKS_PLUGIN_ID);
    const generator = this.plugin(GENERATOR_PLUGIN_ID);
    const pluginReport = (id, instance) => instance ? { present: true, version: instance.manifest && instance.manifest.version } : { present: false, id };
    const services = {};
    if (atlas) {
      for (const key of Object.keys(atlas)) {
        const v = atlas[key];
        if (v && typeof v === "object" && typeof v.then !== "function")
          services[key] = this.className(v);
      }
    }
    return {
      ok: true,
      bridge: { id: this.manifest.id, name: this.manifest.name, version: this.manifest.version },
      extensionApiVersion: this.api && this.api.apiVersion,
      plugins: {
        "atlas-vtt": pluginReport(ATLAS_PLUGIN_ID, atlas),
        "obsidian-5e-statblocks": pluginReport(STATBLOCKS_PLUGIN_ID, statblocks),
        "fantasy-content-generator": pluginReport(GENERATOR_PLUGIN_ID, generator)
      },
      atlasServices: services,
      capabilities: {
        readAssetLibrary: true,
        readAndWriteSettings: Boolean(this.atlasService("settingsService")),
        playerViewImage: Boolean(this.atlasService("imageDisplayService")),
        tabletopCommands: true,
        readBestiary: Boolean(this.statblocksApi())
      },
      statblocksApi: (() => {
        const api = this.statblocksApi();
        if (!api)
          return { available: false };
        const methods = {};
        for (const m of ["getBestiaryNames", "getBestiaryCreatures", "hasCreature", "getCreature", "getCreatureFromBestiary", "isResolved"]) {
          methods[m] = typeof api[m] === "function";
        }
        let resolved;
        try {
          resolved = typeof api.isResolved === "function" ? Boolean(api.isResolved()) : void 0;
        } catch (err) {
          resolved = void 0;
        }
        return { available: true, resolved, methods };
      })(),
      mcp: {
        argumentChannel: this.diagnostics.mcpArgumentChannel,
        tools: this.registeredTools,
        parameterizedTools: this.parameterizedTools
      },
      restRoutes: {
        base: "/vault/<any-note>/" + ROUTE_PREFIX + "/",
        endpoints: [
          "GET  capabilities",
          "GET  collections",
          "GET  assets?collection=&type=&nameContains=&limit=",
          "GET  bestiary?name=&source=notes|srd&nameContains=&limit=",
          "GET  settings?key=   (key may be a dot path, e.g. localPlayerView.showGrid)",
          "POST settings                     {key, value}  (key must already exist)",
          "GET  player-image",
          "POST player-image                 {path}",
          "DELETE player-image               (or POST player-image/dismiss)",
          "POST command                      {commandId}"
        ]
      },
      registeredMcpTools: this.registeredTools.filter((t) => typeof t === "string"),
      diagnostics: this.diagnostics
    };
  }
  // =====================================================================
  // Asset library (read-only, from Atlas's metadata store)
  // =====================================================================
  async listAssets(args) {
    args = args || {};
    let data;
    try {
      data = await this.readJson(ATLAS_ASSETS_PATH);
    } catch (err) {
      return { ok: false, error: "Could not read Atlas asset metadata: " + this.describe(err), path: ATLAS_ASSETS_PATH };
    }
    const all = data && data.assets ? Object.keys(data.assets).map((k) => Object.assign({ id: k }, data.assets[k])) : [];
    let items = all;
    if (args.collection)
      items = items.filter((a) => a.collection === args.collection);
    if (args.type)
      items = items.filter((a) => a.type === args.type);
    if (args.nameContains) {
      const needle = String(args.nameContains).toLowerCase();
      items = items.filter((a) => String(a.name || "").toLowerCase().indexOf(needle) >= 0);
    }
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 200;
    const trimmed = items.slice(0, limit).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      collection: a.collection,
      imagePath: a.imagePath,
      tags: a.tags,
      modifiedAt: a.modifiedAt
    }));
    return { ok: true, total: all.length, matched: items.length, returned: trimmed.length, assets: trimmed };
  }
  async listCollections() {
    let data;
    try {
      data = await this.readJson(ATLAS_ASSETS_PATH);
    } catch (err) {
      return { ok: false, error: "Could not read Atlas asset metadata: " + this.describe(err) };
    }
    const collectionsRaw = data && data.collections || {};
    const assets = data && data.assets || {};
    const counts = {};
    for (const key of Object.keys(assets)) {
      const c = assets[key] && assets[key].collection;
      if (c)
        counts[c] = (counts[c] || 0) + 1;
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
  async getSettings(args) {
    args = args || {};
    const svc = this.atlasService("settingsService");
    if (svc && typeof svc.getAllSettings === "function") {
      try {
        const all = svc.getAllSettings();
        if (args.key) {
          const hit = this.resolveSettingKey(all || {}, args.key);
          if (!hit.found) {
            return {
              ok: false,
              source: "settingsService",
              key: args.key,
              error: "No such setting key: " + args.key,
              knownKeys: Object.keys(all || {}),
              hint: 'Nested settings need a dot path, e.g. "localPlayerView.showGrid".'
            };
          }
          return { ok: true, source: "settingsService", key: args.key, value: hit.value };
        }
        return { ok: true, source: "settingsService", settings: all };
      } catch (err) {
        return { ok: false, error: "settingsService.getAllSettings failed: " + this.describe(err) };
      }
    }
    try {
      const all = await this.readJson(ATLAS_SETTINGS_PATH);
      if (args.key) {
        const hit = this.resolveSettingKey(all || {}, args.key);
        if (!hit.found)
          return { ok: false, source: "file", key: args.key, error: "No such setting key: " + args.key };
        return { ok: true, source: "file", key: args.key, value: hit.value };
      }
      return { ok: true, source: "file", settings: all };
    } catch (err) {
      return { ok: false, error: "Could not read Atlas settings: " + this.describe(err) };
    }
  }
  async setSetting(args) {
    if (!args || !args.key)
      return { ok: false, error: 'A "key" is required.' };
    const svc = this.atlasService("settingsService");
    if (!svc || typeof svc.setSetting !== "function") {
      return {
        ok: false,
        error: "Atlas settings service unavailable; refusing to write behind the plugin's back."
      };
    }
    try {
      const current = typeof svc.getAllSettings === "function" ? svc.getAllSettings() : await this.readJson(ATLAS_SETTINGS_PATH);
      const probe = this.resolveSettingKey(current || {}, args.key);
      if (!probe.found) {
        return {
          ok: false,
          key: args.key,
          error: "Unknown settings key: " + args.key,
          knownKeys: Object.keys(current || {}),
          hint: 'The key must already exist. Nested settings need a dot path, e.g. "localPlayerView.showGrid".'
        };
      }
      const before = probe.value;
      try {
        svc.setSetting(args.key, args.value);
      } catch (err) {
        if (!String(args.key).includes("."))
          throw err;
        const rootKey = String(args.key).split(".")[0];
        const copy = JSON.parse(JSON.stringify(current[rootKey]));
        if (!this.setNestedKey(copy, String(args.key).slice(rootKey.length + 1), args.value))
          throw err;
        svc.setSetting(rootKey, copy);
      }
      const afterAll = typeof svc.getAllSettings === "function" ? svc.getAllSettings() : current;
      const after = this.resolveSettingKey(afterAll || {}, args.key);
      return { ok: true, key: args.key, before, after: after.found ? after.value : void 0, applied: after.found };
    } catch (err) {
      return { ok: false, error: "settingsService.setSetting failed: " + this.describe(err) };
    }
  }
  // =====================================================================
  // Player window image (the reveal / hand-out action)
  // =====================================================================
  async playerImageStatus() {
    const svc = this.atlasService("imageDisplayService");
    if (!svc || typeof svc.isImageDisplayed !== "function") {
      return { ok: false, error: "Atlas image display service unavailable." };
    }
    try {
      return { ok: true, isImageDisplayed: Boolean(svc.isImageDisplayed()) };
    } catch (err) {
      return { ok: false, error: "isImageDisplayed failed: " + this.describe(err) };
    }
  }
  async showImageOnPlayerView(args) {
    if (!args || !args.path)
      return { ok: false, error: 'A "path" is required.' };
    const svc = this.atlasService("imageDisplayService");
    if (!svc || typeof svc.displayImageOnPlayerView !== "function") {
      return { ok: false, error: "Atlas image display service unavailable." };
    }
    const cleaned = String(args.path).replace(/^\/+/, "");
    const file = this.app.vault.getAbstractFileByPath(cleaned);
    if (!file)
      return { ok: false, error: "No vault file at path: " + cleaned };
    const attempts = [];
    for (const candidate of [file, cleaned]) {
      const kind = candidate === file ? "TFile" : "string";
      try {
        await svc.displayImageOnPlayerView(candidate);
        const immediate = typeof svc.isImageDisplayed === "function" ? Boolean(svc.isImageDisplayed()) : void 0;
        await new Promise((resolve) => setTimeout(resolve, 400));
        const settled = typeof svc.isImageDisplayed === "function" ? Boolean(svc.isImageDisplayed()) : void 0;
        const out = { ok: true, path: cleaned, acceptedArgument: kind, isImageDisplayed: settled };
        if (immediate === false && settled !== true) {
          out.note = 'displayImageOnPlayerView returned without displaying: the Atlas player window is not open. Atlas opens it from a LOADED MAP via vtt_execute_command with commandId "atlas-vtt:send-map-to-player-view". Without a player window Atlas only shows a notice and keeps the image unmounted; this call cannot be trusted until one exists.';
          out.ok = false;
          out.error = "Player window not open; image was not displayed.";
        }
        return out;
      } catch (err) {
        attempts.push({ kind, error: this.describe(err) });
      }
    }
    return { ok: false, path: cleaned, error: "Atlas rejected every argument shape tried.", attempts };
  }
  async dismissPlayerImage() {
    const svc = this.atlasService("imageDisplayService");
    if (!svc || typeof svc.closeImageDisplay !== "function") {
      return { ok: false, error: "Atlas image display service unavailable." };
    }
    try {
      const wasDisplayed = typeof svc.isImageDisplayed === "function" ? Boolean(svc.isImageDisplayed()) : void 0;
      svc.closeImageDisplay();
      return { ok: true, wasDisplayed };
    } catch (err) {
      return { ok: false, error: "closeImageDisplay failed: " + this.describe(err) };
    }
  }
  // =====================================================================
  // Commands (UI-only actions), restricted to the tabletop plugins
  // =====================================================================
  async executeTabletopCommand(args) {
    const id = args && args.commandId;
    if (!id)
      return { ok: false, error: 'A "commandId" is required.' };
    if (!TABLETOP_COMMAND_PREFIXES.some((p) => String(id).indexOf(p) === 0)) {
      return {
        ok: false,
        error: "Refused: this bridge runs only tabletop plugin commands.",
        allowedPrefixes: TABLETOP_COMMAND_PREFIXES,
        hint: "Use the Local REST API plugin's own command tools for general Obsidian commands."
      };
    }
    const commands = this.app.commands;
    if (!commands || typeof commands.executeCommandById !== "function") {
      return { ok: false, error: "Obsidian command API unavailable." };
    }
    const registry = commands.commands;
    if (registry && typeof registry === "object" && !(id in registry)) {
      return { ok: false, error: "No such command: " + id };
    }
    try {
      const result = commands.executeCommandById(id);
      const executed = result !== false;
      const outcome = { ok: true, commandId: id, executed };
      if (!executed) {
        outcome.note = "Command is registered but declined to run in the current context (its availability check returned false). Open the view it needs, then retry.";
      }
      return outcome;
    } catch (err) {
      return { ok: false, commandId: id, error: this.describe(err) };
    }
  }
  cleanupMcp() {
    for (const off of this.mcpCleanups) {
      try {
        off();
      } catch (e) {
      }
    }
    this.mcpCleanups = [];
    this.registeredTools = [];
    this.parameterizedTools = [];
    this.registered = false;
  }
  onunload() {
    this.cleanupMcp();
  }
};
