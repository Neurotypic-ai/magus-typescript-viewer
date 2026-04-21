// This color ramp is user-tunable — consider bucketed vs linear, and palette
// choices (colorblind-safe Viridis, sequential, diverging) when iterating.
// Keep this module pure: no imports from Pinia/Vue reactivity, no side
// effects. Heatmap helpers are called from both composables and direct
// render paths, so they must stay synchronous and deterministic.

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Three-stop palette used by all heatmap helpers below.
 *   low  — green-500  (healthy / low metric value)
 *   mid  — yellow-500 (borderline / approaching threshold)
 *   high — red-500    (problematic / exceeds threshold)
 */
const LOW_COLOR: RGBColor = { r: 34, g: 197, b: 94 };
const MID_COLOR: RGBColor = { r: 234, g: 179, b: 8 };
const HIGH_COLOR: RGBColor = { r: 239, g: 68, b: 68 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function lerpColor(from: RGBColor, to: RGBColor, t: number): RGBColor {
  return {
    r: lerpChannel(from.r, to.r, t),
    g: lerpChannel(from.g, to.g, t),
    b: lerpChannel(from.b, to.b, t),
  };
}

function formatRgb(color: RGBColor): string {
  return `rgb(${String(color.r)}, ${String(color.g)}, ${String(color.b)})`;
}

/**
 * Interpolate across the three-stop palette for a normalized value (0..1).
 * 0.0 → low, 0.5 → mid, 1.0 → high.
 */
function rampColor(normalized: number): string {
  const t = clamp01(normalized);
  if (t <= 0.5) {
    const segmentT = t / 0.5;
    return formatRgb(lerpColor(LOW_COLOR, MID_COLOR, segmentT));
  }
  const segmentT = (t - 0.5) / 0.5;
  return formatRgb(lerpColor(MID_COLOR, HIGH_COLOR, segmentT));
}

function safeRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return value / max;
}

/**
 * Map a cyclomatic complexity score to a heatmap color.
 * Typical thresholds: 10 = warning, 20 = error, 30 = severe.
 */
export function complexityToColor(value: number, max = 30): string {
  return rampColor(safeRatio(value, max));
}

/**
 * Map combined coupling (Ca + Ce) to a heatmap color. High total coupling on
 * a module signals instability regardless of direction; using the sum keeps
 * the overlay readable without showing two separate ramps per node.
 */
export function couplingToColor(afferent: number, efferent: number, max = 20): string {
  const ca = Number.isFinite(afferent) ? Math.max(0, afferent) : 0;
  const ce = Number.isFinite(efferent) ? Math.max(0, efferent) : 0;
  return rampColor(safeRatio(ca + ce, max));
}

/**
 * Map `any` density (0..1 fraction of `any`-typed slots) to a heatmap color.
 * Inputs outside [0, 1] are clamped.
 */
export function anyDensityToColor(density: number): string {
  return rampColor(clamp01(Number.isFinite(density) ? density : 0));
}
