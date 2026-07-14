import { create } from "zustand";

type CommandUiState = {
  paletteOpen: boolean;
  paletteClosedAt: number;
  openPalette: () => void;
  closePalette: () => void;
};

export const useCommandUiStore = create<CommandUiState>((set) => ({
  paletteOpen: false,
  paletteClosedAt: 0,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false, paletteClosedAt: Date.now() }),
}));
