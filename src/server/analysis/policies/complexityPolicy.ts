import type { AnalysisThresholds } from '../types';

/**
 * Classify a function/method's complexity given cyclomatic + cognitive scores.
 *
 * Learning contribution point - thresholds encode THIS codebase's risk
 * appetite. Vue components and reducers tolerate higher cyclomatic; pure
 * logic and parsers should stay lean. Tune these rules so alerts stay
 * actionable without drowning in yellow.
 *
 * @param metrics - the raw metric values for a single entity
 * @param thresholds - configured project thresholds (already loaded)
 * @param entityCategory - hint for category-specific adjustments
 */
export type ComplexityClass = 'ok' | 'warn' | 'error';

export function classifyComplexity(
  metrics: { cyclomatic?: number; cognitive?: number; maxNesting?: number; parameterCount?: number },
  thresholds: AnalysisThresholds,
  _entityCategory?: 'method' | 'function' | 'class'
): ComplexityClass {
  // TODO(user): implement 5-10 lines balancing cyclomatic vs cognitive.
  // Default below uses cyclomatic only - replace with your preferred rule.
  const cc = metrics.cyclomatic ?? 0;
  if (cc >= thresholds.cyclomatic.error) return 'error';
  if (cc >= thresholds.cyclomatic.warning) return 'warn';
  return 'ok';
}
