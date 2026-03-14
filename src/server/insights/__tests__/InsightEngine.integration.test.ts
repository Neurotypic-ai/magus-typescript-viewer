import { describe, expect, it } from 'vitest';

import { createMockDatabaseAdapter } from '../../__tests__/factories/mockDatabaseAdapter';
import { InsightEngine } from '../InsightEngine';

import type { InsightIgnoreRules } from '../insightignore';

const modulesQuery =
  'SELECT id, package_id, name, directory, relative_path, is_barrel, line_count FROM modules';
const importsQuery = 'SELECT id, module_id, source, is_type_only FROM imports';

function createGraphBackedAdapter() {
  return createMockDatabaseAdapter([
    {
      matcher: modulesQuery,
      rows: [
        {
          id: 'm-a',
          package_id: 'pkg-1',
          name: 'a',
          directory: 'src',
          relative_path: 'src/a.ts',
          is_barrel: false,
          line_count: 20,
        },
        {
          id: 'm-b',
          package_id: 'pkg-1',
          name: 'b',
          directory: 'src',
          relative_path: 'src/b.ts',
          is_barrel: false,
          line_count: 24,
        },
      ],
    },
    {
      matcher: importsQuery,
      rows: [
        {
          id: 'imp-a',
          module_id: 'm-a',
          source: './b',
          is_type_only: false,
        },
        {
          id: 'imp-b',
          module_id: 'm-b',
          source: './a',
          is_type_only: false,
        },
      ],
    },
  ]);
}

describe('InsightEngine integration', () => {
  it('uses real import graph construction during compute()', async () => {
    const adapter = createGraphBackedAdapter();
    const engine = new InsightEngine(adapter);

    const report = await engine.compute('pkg-1');
    const circularInsight = report.insights.find((insight) => insight.type === 'circular-imports');

    expect(report.packageId).toBe('pkg-1');
    expect(circularInsight).toBeDefined();
    expect((circularInsight?.entities.length ?? 0) > 0).toBe(true);
    expect(circularInsight?.description).toContain('cycle');
  });

  it('applies suppression rules after real graph-based insight generation', async () => {
    const adapter = createGraphBackedAdapter();
    const noSuppressEngine = new InsightEngine(adapter);
    const withoutSuppression = await noSuppressEngine.compute('pkg-1');

    const rules: InsightIgnoreRules = {
      suppressedKinds: new Set(['circular-imports']),
      filePatterns: [],
      kindFilePatterns: new Map(),
    };

    const suppressedEngine = new InsightEngine(adapter, rules);
    const withSuppression = await suppressedEngine.compute('pkg-1');

    expect(withoutSuppression.insights.some((insight) => insight.type === 'circular-imports')).toBe(true);
    expect(withSuppression.insights.some((insight) => insight.type === 'circular-imports')).toBe(false);
    expect(withSuppression.healthScore).toBeGreaterThanOrEqual(withoutSuppression.healthScore);
  });
});
