export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ModCapability =
  | "network"
  | "notifications"
  | "clipboard.write"
  | "files.user-selected"
  | "secrets"
  | "game-entry";

export type ModSettingDefinition =
  | { type: "boolean"; label: string; description?: string; default?: boolean }
  | {
      type: "string";
      label: string;
      description?: string;
      default?: string;
      placeholder?: string;
    }
  | {
      type: "number";
      label: string;
      description?: string;
      default?: number;
      minimum?: number;
      maximum?: number;
      step?: number;
      placeholder?: string;
    }
  | {
      type: "select";
      label: string;
      description?: string;
      default?: string;
      options: { value: string; label: string }[];
    }
  | { type: "secret"; label: string; description?: string };

export interface ModManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  entry: string;
  gameEntry?: string;
  capabilities: ModCapability[];
  network?: string[];
  settings?: Record<string, ModSettingDefinition>;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  repository?: string;
  minTweliaVersion?: string;
}

export type ModSession = Readonly<{ id: string; accountId: string }>;
export type ModUiTone = "default" | "muted" | "info" | "success" | "warning" | "danger";

export type ModUiComponent =
  | { type: "section"; id?: string; title?: string; children: ModUiComponent[] }
  | { type: "row"; id?: string; children: ModUiComponent[] }
  | { type: "collapsible"; id?: string; title: string; open?: boolean; children: ModUiComponent[] }
  | {
      type: "text";
      id?: string;
      text: string;
      style?: "body" | "heading" | "caption" | "code";
      tone?: ModUiTone;
    }
  | { type: "badge"; id?: string; text: string; tone?: ModUiTone }
  | {
      type: "button";
      id: string;
      label: string;
      variant?: "primary" | "secondary" | "danger" | "ghost";
      disabled?: boolean;
    }
  | {
      type: "input" | "textarea";
      id: string;
      label?: string;
      value?: string;
      placeholder?: string;
      disabled?: boolean;
    }
  | {
      type: "select";
      id: string;
      label?: string;
      value?: string;
      options: { value: string; label: string }[];
      disabled?: boolean;
    }
  | { type: "switch"; id: string; label: string; value?: boolean; disabled?: boolean }
  | {
      type: "number" | "slider";
      id: string;
      label?: string;
      value?: number;
      minimum?: number;
      maximum?: number;
      step?: number;
      placeholder?: string;
      disabled?: boolean;
    }
  | { type: "progress"; id?: string; label?: string; value?: number }
  | {
      type: "table";
      columns: { key: string; label: string }[];
      rows: Record<string, JsonPrimitive>[];
    }
  | { type: "separator" };

export type ModUiPanel = { id: string; title: string; components: ModUiComponent[] };

export type ModEvents = {
  load: Record<string, never>;
  unload: Record<string, never>;
  "session.ready": { sessionId: string; accountId: string };
  "session.suspended": Record<string, never>;
  "session.resumed": Record<string, never>;
  "session.reloaded": Record<string, never>;
  "settings.changed": Record<string, JsonValue>;
  "ui.action": { panelId: string; actionId: string; value: JsonValue };
  "command.execute": { commandId: string; sessionId: string };
  "group.message": { fromSessionId: string; fromAccountId: string; message: JsonValue };
  "game-side.message": { type: string; payload: Record<string, JsonValue> };
  "game.map": Record<string, JsonValue>;
  "game.movement": Record<string, JsonValue>;
  "game.fight": Record<string, JsonValue>;
  "game.party-fight": Record<string, JsonValue>;
  "game.action": Record<string, JsonValue>;
};

export type ModEventName = keyof ModEvents | (string & {});
export type ModEventPayload<T extends ModEventName> = T extends keyof ModEvents
  ? ModEvents[T]
  : JsonValue;

export type Unsubscribe = () => void;
export type ModHttpRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  json?: JsonValue;
  timeoutMs?: number;
};

export type ModHttpResponse = {
  status: number;
  ok: boolean;
  url: string;
  headers: Record<string, string>;
  body: string;
};

export interface TweliaApi {
  readonly session: ModSession;
  readonly api: Readonly<{
    version: number;
    runtimeVersion: string;
    features: readonly string[];
  }>;
  readonly capabilities: {
    readonly list: readonly ModCapability[];
    has(capability: ModCapability): boolean;
  };
  on<T extends ModEventName>(
    type: T,
    handler: (payload: ModEventPayload<T>) => void | Promise<void>,
    options?: { once?: boolean; signal?: AbortSignal },
  ): Unsubscribe;
  log: {
    debug(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
    error(message: unknown): void;
  };
  ui: {
    mount(panel: ModUiPanel): string;
    update(panel: ModUiPanel): string;
    patch(panelId: string, changes: Record<`${string}.${string}`, JsonValue>): string;
    unmount(panelId: string): void;
  };
  settings: {
    get<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): Readonly<T>;
    onChange<T extends Record<string, JsonValue> = Record<string, JsonValue>>(
      handler: (settings: T) => void | Promise<void>,
    ): Unsubscribe;
  };
  storage: {
    get<T extends JsonValue>(key: string, fallback?: T): T;
    set<T extends JsonValue>(key: string, value: T): T;
    remove(key: string): void;
    getMany(keys: string[]): Record<string, JsonValue>;
    setMany(values: Record<string, JsonValue>): Record<string, JsonValue>;
    transaction<T extends Record<string, JsonValue>>(mutator: (draft: T) => T | void): T;
    migrate<T extends Record<string, JsonValue>>(
      targetVersion: number,
      migrations: Record<number, (values: T) => T | void>,
    ): T;
    quota(): { usedKeys: number; maxKeys: number; usedBytes: number; maxBytes: number };
  };
  secrets: {
    get(key: string, fallback?: string | null): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  time: {
    setTimeout(callback: () => void | Promise<void>, delayMs: number): number;
    clearTimeout(id: number): void;
    setInterval(callback: () => void | Promise<void>, delayMs: number): number;
    clearInterval(id: number): void;
    sleep(delayMs: number): Promise<void>;
  };
  request<T extends JsonValue = JsonValue>(
    service: string,
    payload?: JsonValue,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T>;
  http: {
    request(
      options: ModHttpRequest,
      control?: { timeoutMs?: number; signal?: AbortSignal },
    ): Promise<ModHttpResponse>;
  };
  notifications: { show(title: string, body: string): Promise<void> };
  clipboard: { writeText(text: string): Promise<void> };
  files: {
    pickText(): Promise<{ cancelled: boolean; name?: string; text?: string }>;
    saveText(suggestedName: string, text: string): Promise<{ cancelled: boolean; name?: string }>;
  };
  commands: {
    register(definition: {
      id: string;
      title: string;
      description?: string;
      shortcut?: string;
      execute(): void | Promise<void>;
    }): Unsubscribe;
  };
  group: { broadcast(message: Record<string, JsonValue>): void };
  gameSide: { send(type: string, payload?: Record<string, JsonValue>): void };
  game: {
    observeMap(): void;
    moveToCell(cellId: number): void;
    changeMap(direction: "left" | "right" | "top" | "bottom"): void;
    attackMonster(groupId: number): void;
    joinPartyFight(fightId: number, fighterId: number): void;
    observeFight(): void;
    setFightPlacement(cellId: number): void;
    moveInFight(cellId: number): void;
    castFightSpell(spellId: number, targetCellId: number): void;
    fightReady(): void;
    finishFightTurn(): void;
  };
}

export type ModDefinition = {
  load?(api: TweliaApi): void | Promise<void>;
  unload?(): void | Promise<void>;
};

export declare function defineMod<T extends ModDefinition>(definition: T): T;

declare global {
  const twelia: TweliaApi;
}
