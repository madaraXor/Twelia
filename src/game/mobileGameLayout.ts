export const MOBILE_GAME_LOGICAL_WIDTH = 1280;

export type MobileGameFrameLayout = {
  width: number;
  height: number;
  scale: number;
};

export function computeMobileGameFrameLayout(
  containerWidth: number,
  containerHeight: number,
): MobileGameFrameLayout | undefined {
  if (containerWidth <= 0 || containerHeight <= 0) return;
  const scale = Math.min(1, containerWidth / MOBILE_GAME_LOGICAL_WIDTH);
  return {
    width: containerWidth / scale,
    height: containerHeight / scale,
    scale,
  };
}
