import type { DatabaseRow, IDatabaseAdapter, QueryParams, QueryResult } from '../../db/adapter/IDatabaseAdapter';

type QueryMatcher = RegExp | string | ((sql: string, params: QueryParams | undefined) => boolean);

interface QueryStub<T extends DatabaseRow = DatabaseRow> {
  matcher: QueryMatcher;
  rows:
    | QueryResult<T>
    | ((sql: string, params: QueryParams | undefined) => QueryResult<T> | Promise<QueryResult<T>>);
}

function isMatch(matcher: QueryMatcher, sql: string, params: QueryParams | undefined): boolean {
  if (typeof matcher === 'string') {
    return sql.includes(matcher);
  }
  if (matcher instanceof RegExp) {
    return matcher.test(sql);
  }
  return matcher(sql, params);
}

export function createMockDatabaseAdapter(stubs: QueryStub[] = []): IDatabaseAdapter {
  return {
    init: async () => {},
    close: async () => {},
    getDbPath: () => ':memory:',
    transaction: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
    query: async <T extends DatabaseRow>(sql: string, params?: QueryParams): Promise<QueryResult<T>> => {
      for (const stub of stubs) {
        if (!isMatch(stub.matcher, sql, params)) {
          continue;
        }

        if (typeof stub.rows === 'function') {
          return Promise.resolve(stub.rows(sql, params) as QueryResult<T>);
        }

        return stub.rows as QueryResult<T>;
      }
      return [] as QueryResult<T>;
    },
  };
}
