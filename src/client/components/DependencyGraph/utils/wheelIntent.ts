export type WheelIntent = 'pinch' | 'mouseWheel' | 'trackpadScroll';

/**
 * Classifies a WheelEvent into one of three intent categories.
 *
 * On macOS, trackpad gestures and mouse wheel events both fire WheelEvent,
 * but with different characteristics that allow heuristic classification.
 *
 * When `isMac` is true, all pixel-based (deltaMode=0) non-pinch events are
 * classified as trackpadScroll. This is because macOS trackpads and Magic Mouse
 * both emit deltaMode=0, and both should pan rather than zoom. Discrete scroll
 * wheels use deltaMode=1 (line-based) and are correctly classified as mouseWheel.
 */
export function classifyWheelIntent(event: WheelEvent, isMac = false): WheelIntent {
  // ctrlKey is set by browsers for pinch-to-zoom gestures (Mac Chrome/Safari)
  if (event.ctrlKey) return 'pinch';

  // deltaMode=1 (DOM_DELTA_LINE) = mouse wheel with line-based scrolling
  if (event.deltaMode !== 0) return 'mouseWheel';

  // On macOS, all pixel-based scroll events come from trackpads or Magic Mouse.
  // Both should pan, not zoom. Discrete scroll wheels use deltaMode=1.
  if (isMac) return 'trackpadScroll';

  // Non-Mac: deltaMode=0 (DOM_DELTA_PIXEL) heuristic classification
  // Trackpads often produce horizontal delta; mouse wheels are Y-only
  if (Math.abs(event.deltaX) > 0) return 'trackpadScroll';

  // Small Y deltas are characteristic of trackpad inertial scrolling
  if (Math.abs(event.deltaY) < 40) return 'trackpadScroll';

  return 'mouseWheel';
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
