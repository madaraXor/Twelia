import { create } from "zustand";
import { getModsEnabled, setModsEnabled } from "./modService";

type ModState = {
  enabled: boolean;
  hydrated: boolean;
  loading: boolean;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};

export const useModStore = create<ModState>((set, get) => ({
  enabled: false,
  hydrated: false,
  loading: false,
  load: async () => {
    if (get().hydrated || get().loading) return;
    set({ loading: true });
    try {
      set({ enabled: await getModsEnabled(), hydrated: true });
    } finally {
      set({ loading: false });
    }
  },
  setEnabled: async (enabled) => {
    set({ loading: true });
    try {
      await setModsEnabled(enabled);
      set({ enabled, hydrated: true });
    } finally {
      set({ loading: false });
    }
  },
}));
