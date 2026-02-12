export type WheelIntent = 'pinch' | 'mouseWheel' | 'trackpadScroll';

/**
 * Classifies a WheelEvent into one of three intent categories.
 *
 * On macOS, trackpad gestures and mouse wheel events both fire WheelEvent,
 * but with different characteristics that allow heuristic classification.
 */
export function classifyWheelIntent(event: WheelEvent): WheelIntent {
  // ctrlKey is set by browsers for pinch-to-zoom gestures (Mac Chrome/Safari)
  if (event.ctrlKey) return 'pinch';

  // deltaMode=1 (DOM_DELTA_LINE) = mouse wheel with line-based scrolling
  if (event.deltaMode !== 0) return 'mouseWheel';

  // deltaMode=0 (DOM_DELTA_PIXEL): heuristic classification
  // Trackpads often produce horizontal delta; mouse wheels are Y-only
  if (Math.abs(event.deltaX) > 0) return 'trackpadScroll';

  // Small Y deltas are characteristic of trackpad inertial scrolling
  if (Math.abs(event.deltaY) < 40) return 'trackpadScroll';

  return 'mouseWheel';
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
