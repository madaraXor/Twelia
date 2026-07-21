export type ModManifest = {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  entry: string;
  gameEntry?: string;
  network: string[];
  capabilities: ModCapability[];
  settings: Record<string, ModSettingDefinition>;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  repository?: string;
  minTweliaVersion?: string;
};

export type ModCapability =
  | "network"
  | "notifications"
  | "clipboard.write"
  | "files.user-selected"
  | "secrets"
  | "game-entry";

export type ModSettingDefinition = {
  type: "boolean" | "string" | "number" | "select" | "secret";
  label: string;
  description?: string;
  default?: unknown;
  placeholder?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  options?: { value: string; label: string }[];
};

export type InstalledMod = {
  manifest: ModManifest;
  enabled: boolean;
};

export type ModInstanceState = "starting" | "running" | "failed" | "stopped";

export type ModInstance = {
  modId: string;
  sessionId: string;
  accountId: string;
  state: ModInstanceState;
  startedAt: string;
  lastError?: string;
};

export type ModLogLevel = "debug" | "info" | "warn" | "error";

export type ModLogEntry = {
  sequence: number;
  timestamp: string;
  modId: string;
  sessionId: string;
  level: ModLogLevel;
  message: string;
};

export type ModUiTone = "default" | "muted" | "info" | "success" | "warning" | "danger";

export type ModUiComponent =
  | { type: "section"; id?: string; title?: string; children: ModUiComponent[] }
  | { type: "row"; id?: string; children: ModUiComponent[] }
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
      type: "input";
      id: string;
      label?: string;
      value?: string;
      placeholder?: string;
      disabled?: boolean;
    }
  | {
      type: "textarea";
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
      type: "collapsible";
      id?: string;
      title: string;
      open?: boolean;
      children: ModUiComponent[];
    }
  | {
      type: "table";
      columns: { key: string; label: string }[];
      rows: Record<string, string | number | boolean | null>[];
    }
  | { type: "separator" };

export type ModUiPanel = {
  modId: string;
  sessionId: string;
  id: string;
  title: string;
  components: ModUiComponent[];
  revision: number;
};

export type ModCommand = {
  modId: string;
  sessionId: string;
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
};
