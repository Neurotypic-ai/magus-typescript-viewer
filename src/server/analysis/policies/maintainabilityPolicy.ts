/**
 * Compute the Maintainability Index from Halstead volume, cyclomatic complexity,
 * and logical lines of code.
 *
 * Learning contribution point - the canonical MS formula
 *   MI = 171 - 5.2 * ln(V) - 0.23 * CC - 16.2 * ln(LOC)
 * was calibrated for C++. For TypeScript you may want to substitute cognitive
 * for cyclomatic, or adjust the coefficients to taste. Clamp output to [0, 100].
 */
export function computeMaintainabilityIndex(params: {
  halsteadVolume: number;
  cyclomatic: number;
  logicalLines: number;
}): number {
  // TODO(user): customize the formula or coefficients.
  const { halsteadVolume, cyclomatic, logicalLines } = params;
  const safeLn = (x: number): number => Math.log(Math.max(x, 1));
  const raw = 171 - 5.2 * safeLn(halsteadVolume) - 0.23 * cyclomatic - 16.2 * safeLn(logicalLines);
  return Math.max(0, Math.min(100, raw));
}
