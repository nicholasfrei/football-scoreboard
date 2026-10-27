export const DISPLAY_WIDTH = 1920;
export const DISPLAY_HEIGHT = 1200;

export function displayScale(viewportWidth, viewportHeight) {
  return Math.min(1, viewportWidth / DISPLAY_WIDTH, viewportHeight / DISPLAY_HEIGHT);
}
