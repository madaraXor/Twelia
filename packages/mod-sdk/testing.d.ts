import type {
  JsonValue,
  ModCapability,
  ModHttpRequest,
  ModHttpResponse,
  ModSession,
  ModUiPanel,
  TweliaApi,
} from "./index.js";

export type TestRuntimeOptions = {
  session?: ModSession;
  runtimeVersion?: string;
  features?: string[];
  capabilities?: ModCapability[];
  settings?: Record<string, JsonValue>;
  storage?: Record<string, JsonValue>;
  dataVersion?: number;
  secrets?: TweliaApi["secrets"];
  files?: TweliaApi["files"];
  game?: Partial<TweliaApi["game"]>;
  notification?: (title: string, body: string) => Promise<void>;
  clipboard?: (text: string) => Promise<void>;
  http?: (options: ModHttpRequest) => Promise<ModHttpResponse>;
  request?: (
    service: string,
    payload?: JsonValue,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ) => Promise<JsonValue>;
};

export type TestRuntime = {
  api: TweliaApi;
  emit(type: string, payload?: JsonValue): Promise<void>;
  logs: { level: "debug" | "info" | "warn" | "error"; message: string }[];
  panels: Map<string, ModUiPanel>;
  commands: Map<string, { execute(payload?: JsonValue): void | Promise<void> }>;
  storage: Map<string, JsonValue>;
  install(): () => void;
};

export declare function createTestRuntime(options?: TestRuntimeOptions): TestRuntime;
