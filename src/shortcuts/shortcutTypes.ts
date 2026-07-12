export type ShortcutAction =
  | "next-tab"
  | "previous-tab"
  | "select-tab-1"
  | "select-tab-2"
  | "select-tab-3"
  | "select-tab-4"
  | "select-tab-5"
  | "select-tab-6"
  | "select-tab-7"
  | "select-tab-8"
  | "select-last-tab"
  | "new-game-tab"
  | "close-tab"
  | "reopen-tab"
  | "open-settings"
  | "open-home"
  | "reload-active-session"
  | "toggle-fullscreen"
  | "open-command-palette";

export type ShortcutBinding = {
  action: ShortcutAction;
  label: string;
  accelerator: string | null;
  defaultAccelerator: string;
};

export type ShortcutsDocument = {
  schemaVersion: 1;
  bindings: ShortcutBinding[];
};
