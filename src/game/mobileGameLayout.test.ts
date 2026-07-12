import { describe, expect, it } from "vitest";
import { computeMobileGameFrameLayout } from "./mobileGameLayout";

describe("computeMobileGameFrameLayout", () => {
  it("gives a phone iframe a 1280px logical viewport and fits it back in the tab", () => {
    const layout = computeMobileGameFrameLayout(802, 304);
    expect(layout?.width).toBeCloseTo(1280);
    expect(layout?.height).toBeCloseTo(485.19, 1);
    expect(layout?.scale).toBeCloseTo(0.6265625);
  });

  it("does not enlarge the game on a viewport wider than the logical width", () => {
    expect(computeMobileGameFrameLayout(1600, 900)).toEqual({
      width: 1600,
      height: 900,
      scale: 1,
    });
  });

  it("ignores an unavailable container", () => {
    expect(computeMobileGameFrameLayout(0, 304)).toBeUndefined();
  });
});
