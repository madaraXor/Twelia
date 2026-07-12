import { create } from "zustand";

type CommandUiState = {
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
};

export const useCommandUiStore = create<CommandUiState>((set) => ({
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
}));
