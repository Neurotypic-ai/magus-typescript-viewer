import { vi } from 'vitest';

import type { DatabaseRow, IDatabaseAdapter, QueryParams, QueryResult } from '../adapter/IDatabaseAdapter';

/**
 * Test helper: typed mock that satisfies IDatabaseAdapter.query / .transaction generics.
 */
export function createMockDatabaseAdapter(overrides: Partial<IDatabaseAdapter> = {}): IDatabaseAdapter {
  const query = vi.fn(
    async <T extends DatabaseRow = DatabaseRow>(
      _sql: string,
      _params?: QueryParams
    ): Promise<QueryResult<T>> => []
  ) as IDatabaseAdapter['query'];

  const transaction = vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()) as IDatabaseAdapter['transaction'];

  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    query,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    transaction,
    getDbPath: vi.fn<() => string>().mockReturnValue(':memory:'),
    ...overrides,
  };
}
