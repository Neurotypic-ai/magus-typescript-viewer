import { describe, expect, it } from 'vitest';

import { getLatestReport, getReportHistory, storeInsightReport } from '../insight-store';

import type { DatabaseRow, IDatabaseAdapter, QueryParams, QueryResult } from '../../db/adapter/IDatabaseAdapter';
import type { InsightReport } from '../types';

interface StoredRow extends DatabaseRow {
  id: string;
  package_id: string | null;
  computed_at: string;
  health_score: number;
  report_json: string;
}

function createInMemoryAdapter(seedRows: StoredRow[] = []): {
  adapter: IDatabaseAdapter;
  rows: StoredRow[];
} {
  const rows = [...seedRows];

  const adapter: IDatabaseAdapter = {
    init: async () => {},
    close: async () => {},
    getDbPath: () => ':memory:',
    transaction: async <T>(callback: () => Promise<T>) => callback(),
    query: async <T extends DatabaseRow>(sql: string, params?: QueryParams): Promise<QueryResult<T>> => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS insight_reports')) {
        return [] as QueryResult<T>;
      }

      if (sql.startsWith('INSERT INTO insight_reports')) {
        const [packageId, computedAt, healthScore, reportJson] = (params ?? []) as [
          string | null,
          string,
          number,
          string
        ];
        rows.push({
          id: String(rows.length + 1),
          package_id: packageId,
          computed_at: computedAt,
          health_score: healthScore,
          report_json: reportJson,
        });
        return [] as QueryResult<T>;
      }

      if (sql.includes('FROM insight_reports')) {
        const hasPackageFilter = sql.includes('package_id = ?');
        const hasNullFilter = sql.includes('package_id IS NULL');
        const limit = Number((params ?? [])[hasPackageFilter ? 1 : 0] ?? 50);
        const packageId = hasPackageFilter ? String((params ?? [])[0]) : null;

        const filtered = rows
          .filter((row) => {
            if (hasPackageFilter) return row.package_id === packageId;
            if (hasNullFilter) return row.package_id === null;
            return true;
          })
          .sort((a, b) => b.computed_at.localeCompare(a.computed_at))
          .slice(0, limit);

        return filtered as unknown as QueryResult<T>;
      }

      return [] as QueryResult<T>;
    },
  };

  return { adapter, rows };
}

function buildReport(overrides?: Partial<InsightReport>): InsightReport {
  return {
    packageId: undefined,
    computedAt: '2026-03-14T00:00:00.000Z',
    healthScore: 88,
    summary: { critical: 0, warning: 1, info: 0 },
    insights: [],
    ...overrides,
  };
}

describe('insight-store', () => {
  it('stores and retrieves package and global reports independently', async () => {
    const { adapter } = createInMemoryAdapter();

    await storeInsightReport(
      adapter,
      buildReport({
        computedAt: '2026-03-14T00:00:00.000Z',
      })
    );
    await storeInsightReport(
      adapter,
      buildReport({
        packageId: 'pkg-1',
        computedAt: '2026-03-14T00:01:00.000Z',
        healthScore: 72,
      })
    );

    const globalLatest = await getLatestReport(adapter);
    const packageLatest = await getLatestReport(adapter, 'pkg-1');

    expect(globalLatest?.packageId).toBeUndefined();
    expect(globalLatest?.healthScore).toBe(88);
    expect(packageLatest?.packageId).toBe('pkg-1');
    expect(packageLatest?.healthScore).toBe(72);
  });

  it('skips malformed JSON when retrieving latest and history', async () => {
    const malformedRows: StoredRow[] = [
      {
        id: '1',
        package_id: 'pkg-1',
        computed_at: '2026-03-14T00:00:00.000Z',
        health_score: 80,
        report_json: JSON.stringify(buildReport({ packageId: 'pkg-1', healthScore: 80 })),
      },
      {
        id: '2',
        package_id: 'pkg-1',
        computed_at: '2026-03-14T00:01:00.000Z',
        health_score: 1,
        report_json: '{not-json}',
      },
    ];
    const { adapter } = createInMemoryAdapter(malformedRows);

    const latest = await getLatestReport(adapter, 'pkg-1');
    const history = await getReportHistory(adapter, 'pkg-1', 5);

    expect(latest?.healthScore).toBe(80);
    expect(history).toHaveLength(1);
    expect(history[0]?.healthScore).toBe(80);
  });
});
