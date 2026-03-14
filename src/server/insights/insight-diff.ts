import type { InsightReport, InsightResult } from './types';

export interface InsightDiff {
  previousScore: number;
  currentScore: number;
  scoreDelta: number;
  newInsights: InsightResult[];
  resolvedInsights: InsightResult[];
  unchangedCount: number;
}

/**
 * Builds a composite key for matching insights across reports.
 * Uses (type, entities[0]?.id) — same insight type + same primary entity = same insight.
 */
function insightKey(insight: InsightResult): string {
  const primaryEntityId = insight.entities[0]?.id ?? '';
  return `${insight.type}::${primaryEntityId}`;
}

/**
 * Computes the difference between two InsightReports.
 * Uses O(n) Set/Map lookups for efficient comparison.
 */
export function diffInsights(previous: InsightReport, current: InsightReport): InsightDiff {
  // Build a map of previous insights by key
  const previousByKey = new Map<string, InsightResult>();
  for (const insight of previous.insights) {
    previousByKey.set(insightKey(insight), insight);
  }

  // Build a set of current insight keys
  const currentKeys = new Set<string>();
  const newInsights: InsightResult[] = [];
  let unchangedCount = 0;

  for (const insight of current.insights) {
    const key = insightKey(insight);
    currentKeys.add(key);

    if (previousByKey.has(key)) {
      unchangedCount++;
    } else {
      newInsights.push(insight);
    }
  }

  // Resolved insights: in previous but not in current
  const resolvedInsights: InsightResult[] = [];
  for (const insight of previous.insights) {
    const key = insightKey(insight);
    if (!currentKeys.has(key)) {
      resolvedInsights.push(insight);
    }
  }

  return {
    previousScore: previous.healthScore,
    currentScore: current.healthScore,
    scoreDelta: current.healthScore - previous.healthScore,
    newInsights,
    resolvedInsights,
    unchangedCount,
  };
}
