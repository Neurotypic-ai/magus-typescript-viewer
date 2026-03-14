import { describe, expect, it } from 'vitest';

import { diffInsights } from '../insight-diff';

import type { InsightReport, InsightResult } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInsight(type: InsightResult['type'], entityId: string, severity: InsightResult['severity'] = 'warning'): InsightResult {
  return {
    type,
    category: 'dependency-health',
    severity,
    title: `Test ${type}`,
    description: `Test insight for ${type}`,
    entities: [{ id: entityId, kind: 'module', name: `entity-${entityId}` }],
  };
}

function makeReport(overrides: Partial<InsightReport> = {}): InsightReport {
  return {
    computedAt: new Date().toISOString(),
    healthScore: 100,
    summary: { critical: 0, warning: 0, info: 0 },
    insights: [],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('diffInsights', () => {
  it('produces zero diff for identical reports', () => {
    const insights = [
      makeInsight('god-class', 'entity-1'),
      makeInsight('circular-imports', 'entity-2', 'critical'),
    ];
    const previous = makeReport({ healthScore: 85, insights });
    const current = makeReport({ healthScore: 85, insights });

    const diff = diffInsights(previous, current);

    expect(diff.previousScore).toBe(85);
    expect(diff.currentScore).toBe(85);
    expect(diff.scoreDelta).toBe(0);
    expect(diff.newInsights).toHaveLength(0);
    expect(diff.resolvedInsights).toHaveLength(0);
    expect(diff.unchangedCount).toBe(2);
  });

  it('detects new insight when current has one previous does not', () => {
    const shared = makeInsight('god-class', 'entity-1');
    const added = makeInsight('module-size', 'entity-3');

    const previous = makeReport({ healthScore: 90, insights: [shared] });
    const current = makeReport({ healthScore: 85, insights: [shared, added] });

    const diff = diffInsights(previous, current);

    expect(diff.newInsights).toHaveLength(1);
    expect(diff.newInsights[0].type).toBe('module-size');
    expect(diff.resolvedInsights).toHaveLength(0);
    expect(diff.unchangedCount).toBe(1);
  });

  it('detects resolved insight when previous has one current does not', () => {
    const shared = makeInsight('god-class', 'entity-1');
    const removed = makeInsight('circular-imports', 'entity-2', 'critical');

    const previous = makeReport({ healthScore: 78, insights: [shared, removed] });
    const current = makeReport({ healthScore: 90, insights: [shared] });

    const diff = diffInsights(previous, current);

    expect(diff.resolvedInsights).toHaveLength(1);
    expect(diff.resolvedInsights[0].type).toBe('circular-imports');
    expect(diff.newInsights).toHaveLength(0);
    expect(diff.unchangedCount).toBe(1);
  });

  it('calculates score delta correctly', () => {
    const previous = makeReport({ healthScore: 85, insights: [] });
    const current = makeReport({ healthScore: 78, insights: [] });

    const diff = diffInsights(previous, current);

    expect(diff.previousScore).toBe(85);
    expect(diff.currentScore).toBe(78);
    expect(diff.scoreDelta).toBe(-7);
  });

  it('handles empty previous report (all insights are new)', () => {
    const previous = makeReport({ healthScore: 100, insights: [] });
    const current = makeReport({
      healthScore: 90,
      insights: [
        makeInsight('god-class', 'entity-1'),
        makeInsight('module-size', 'entity-2'),
      ],
    });

    const diff = diffInsights(previous, current);

    expect(diff.newInsights).toHaveLength(2);
    expect(diff.resolvedInsights).toHaveLength(0);
    expect(diff.unchangedCount).toBe(0);
    expect(diff.scoreDelta).toBe(-10);
  });

  it('handles empty current report (all insights are resolved)', () => {
    const previous = makeReport({
      healthScore: 80,
      insights: [
        makeInsight('god-class', 'entity-1'),
        makeInsight('circular-imports', 'entity-2', 'critical'),
      ],
    });
    const current = makeReport({ healthScore: 100, insights: [] });

    const diff = diffInsights(previous, current);

    expect(diff.newInsights).toHaveLength(0);
    expect(diff.resolvedInsights).toHaveLength(2);
    expect(diff.unchangedCount).toBe(0);
    expect(diff.scoreDelta).toBe(20);
  });

  it('distinguishes insights of the same type but different entities', () => {
    const insightA = makeInsight('god-class', 'class-a');
    const insightB = makeInsight('god-class', 'class-b');

    const previous = makeReport({ healthScore: 90, insights: [insightA] });
    const current = makeReport({ healthScore: 90, insights: [insightB] });

    const diff = diffInsights(previous, current);

    // insightA was resolved, insightB is new
    expect(diff.newInsights).toHaveLength(1);
    expect(diff.newInsights[0].entities[0].id).toBe('class-b');
    expect(diff.resolvedInsights).toHaveLength(1);
    expect(diff.resolvedInsights[0].entities[0].id).toBe('class-a');
    expect(diff.unchangedCount).toBe(0);
  });
});
