import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModUiPanelView } from "./ModUiPanelView";
import type { ModUiPanel } from "./modTypes";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const panel: ModUiPanel = {
  modId: "dev.test",
  sessionId: "session-a",
  id: "main",
  title: "Carte",
  revision: 1,
  components: [
    { type: "text", text: "Deux combats", tone: "info" },
    { type: "badge", text: "En ligne", tone: "success" },
    { type: "button", id: "refresh", label: "Actualiser" },
    { type: "input", id: "cell", label: "Cellule", value: "42" },
    { type: "textarea", id: "profile", label: "Profil", value: '{"version":1}' },
    {
      type: "select",
      id: "direction",
      label: "Direction",
      value: "north",
      options: [
        { value: "north", label: "Nord" },
        { value: "south", label: "Sud" },
      ],
    },
  ],
};

describe("ModUiPanelView", () => {
  it("renders safe components and dispatches their actions", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const view = render(<ModUiPanelView panel={panel} onAction={onAction} />);

    expect(screen.getByText("Deux combats")).toBeInTheDocument();
    expect(screen.getByText("En ligne")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("refresh", undefined));

    const input = screen.getByLabelText("Cellule");
    fireEvent.change(input, { target: { value: "57" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("cell", "57"));

    const profile = screen.getByLabelText("Profil");
    fireEvent.change(profile, { target: { value: '{"version":2}' } });
    view.rerender(<ModUiPanelView panel={{ ...panel, revision: 2 }} onAction={onAction} />);
    expect(screen.getByLabelText("Profil")).toHaveValue('{"version":2}');
    fireEvent.blur(profile);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("profile", '{"version":2}'));

    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "south" } });
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("direction", "south"));
  });

  it("renders rich components and dispatches typed values", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <ModUiPanelView
        panel={{
          ...panel,
          id: "rich",
          components: [
            { type: "switch", id: "enabled", label: "Actif", value: false },
            { type: "number", id: "threshold", label: "Seuil", value: 2 },
            { type: "slider", id: "tempo", label: "Tempo", value: 40 },
            { type: "progress", label: "Progression", value: 75 },
            {
              type: "collapsible",
              title: "Détails",
              open: true,
              children: [{ type: "text", text: "Runtime prêt" }],
            },
            {
              type: "table",
              columns: [{ key: "name", label: "Nom" }],
              rows: [{ name: "Bouftou" }],
            },
          ],
        }}
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Actif" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("enabled", true));

    const threshold = screen.getByLabelText("Seuil");
    fireEvent.change(threshold, { target: { value: "4" } });
    fireEvent.blur(threshold);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("threshold", 4));

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Runtime prêt")).toBeInTheDocument();
    expect(screen.getByText("Bouftou")).toBeInTheDocument();
  });
});
