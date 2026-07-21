export function createTestRuntime(options = {}) {
  const handlers = new Map();
  const logs = [];
  const panels = new Map();
  const storageValues = new Map(Object.entries(options.storage || {}));
  const commands = new Map();
  let dataVersion = options.dataVersion || 0;

  const emit = async (type, payload = {}) => {
    if (type === "command.execute") {
      await commands.get(payload.commandId)?.execute(payload);
    }
    for (const handler of [...(handlers.get(type) || [])]) await handler(payload);
  };

  const api = {
    session: Object.freeze(options.session || { id: "test-session", accountId: "test-account" }),
    api: Object.freeze({
      version: 1,
      runtimeVersion: options.runtimeVersion || "test",
      features: Object.freeze([
        ...(options.features || [
          "async-requests",
          "capabilities",
          "commands",
          "declarative-settings",
          "http",
          "platform-services",
          "rich-ui",
          "secrets",
          "storage-migrations",
          "timers",
        ]),
      ]),
    }),
    capabilities: {
      list: Object.freeze([...(options.capabilities || [])]),
      has(capability) {
        return this.list.includes(capability);
      },
    },
    on(type, handler, eventOptions = {}) {
      let abortHandler;
      let listener = handler;
      const off = () => {
        handlers.set(
          type,
          (handlers.get(type) || []).filter((item) => item !== listener),
        );
        if (abortHandler) eventOptions.signal?.removeEventListener("abort", abortHandler);
      };
      if (eventOptions.once) {
        listener = async (payload) => {
          off();
          return handler(payload);
        };
      }
      const listeners = handlers.get(type) || [];
      listeners.push(listener);
      handlers.set(type, listeners);
      if (eventOptions.signal) {
        abortHandler = off;
        if (eventOptions.signal.aborted) off();
        else eventOptions.signal.addEventListener("abort", abortHandler, { once: true });
      }
      return off;
    },
    log: Object.fromEntries(
      ["debug", "info", "warn", "error"].map((level) => [
        level,
        (message) => logs.push({ level, message: String(message) }),
      ]),
    ),
    ui: {
      mount(panel) {
        panels.set(panel.id, structuredClone(panel));
        return panel.id;
      },
      update(panel) {
        panels.set(panel.id, structuredClone(panel));
        return panel.id;
      },
      patch(panelId, changes) {
        const panel = panels.get(panelId);
        if (!panel) throw new Error(`Panneau inconnu : ${panelId}`);
        const components = new Map();
        const visit = (items) => {
          for (const component of items || []) {
            if (component.id) components.set(component.id, component);
            visit(component.children);
          }
        };
        visit(panel.components);
        for (const [path, value] of Object.entries(changes)) {
          const separator = path.lastIndexOf(".");
          const component = components.get(path.slice(0, separator));
          if (!component || separator < 1) throw new Error(`Chemin UI inconnu : ${path}`);
          component[path.slice(separator + 1)] = structuredClone(value);
        }
        return panelId;
      },
      unmount(id) {
        panels.delete(id);
      },
    },
    settings: {
      get: () => Object.freeze(structuredClone(options.settings || {})),
      onChange: (handler) => api.on("settings.changed", handler),
    },
    storage: {
      get: (key, fallback = null) =>
        storageValues.has(key) ? structuredClone(storageValues.get(key)) : fallback,
      set(key, value) {
        storageValues.set(key, structuredClone(value));
        return value;
      },
      remove: (key) => storageValues.delete(key),
      getMany(keys) {
        return Object.fromEntries(
          keys
            .filter((key) => storageValues.has(key))
            .map((key) => [key, structuredClone(storageValues.get(key))]),
        );
      },
      setMany(values) {
        for (const [key, value] of Object.entries(values))
          storageValues.set(key, structuredClone(value));
        return structuredClone(values);
      },
      transaction(mutator) {
        const draft = Object.fromEntries(
          [...storageValues.entries()].map(([key, value]) => [key, structuredClone(value)]),
        );
        const result = mutator(draft) || draft;
        storageValues.clear();
        for (const [key, value] of Object.entries(result))
          storageValues.set(key, structuredClone(value));
        return structuredClone(result);
      },
      migrate(targetVersion, migrations) {
        let nextVersion = dataVersion;
        const migrated = api.storage.transaction((draft) => {
          while (nextVersion < targetVersion) {
            const migration = migrations[nextVersion + 1];
            if (typeof migration !== "function") {
              throw new Error(`Migration manquante vers la version ${nextVersion + 1}`);
            }
            const migrated = structuredClone(migration(draft) || draft);
            for (const key of Object.keys(draft)) delete draft[key];
            Object.assign(draft, migrated);
            nextVersion += 1;
          }
        });
        dataVersion = nextVersion;
        return migrated;
      },
      quota() {
        const encoded = JSON.stringify(Object.fromEntries(storageValues));
        return {
          usedKeys: storageValues.size,
          maxKeys: 256,
          usedBytes: new TextEncoder().encode(encoded).length,
          maxBytes: 1024 * 1024,
        };
      },
    },
    secrets: options.secrets || {
      get: (_key, fallback = null) => fallback,
      set() {},
      remove() {},
    },
    time: {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    },
    http: {
      request:
        options.http ||
        (async () => {
          throw new Error("HTTP mock absent");
        }),
    },
    request:
      options.request ||
      (async () => {
        throw new Error("native request mock absent");
      }),
    notifications: {
      show: options.notification || (async () => {}),
    },
    clipboard: {
      writeText: options.clipboard || (async () => {}),
    },
    files: options.files || {
      pickText: async () => ({ cancelled: true }),
      saveText: async () => ({ cancelled: true }),
    },
    commands: {
      register(definition) {
        commands.set(definition.id, definition);
        return () => commands.delete(definition.id);
      },
    },
    group: { broadcast: (message) => emit("group.broadcast", message) },
    gameSide: { send: (type, payload = {}) => emit("game-side.send", { type, payload }) },
    game: {
      observeMap() {},
      moveToCell() {},
      changeMap() {},
      attackMonster() {},
      joinPartyFight() {},
      observeFight() {},
      setFightPlacement() {},
      moveInFight() {},
      castFightSpell() {},
      fightReady() {},
      finishFightTurn() {},
      ...options.game,
    },
  };

  return {
    api,
    emit,
    logs,
    panels,
    commands,
    storage: storageValues,
    install() {
      globalThis.twelia = api;
      return () => delete globalThis.twelia;
    },
  };
}
