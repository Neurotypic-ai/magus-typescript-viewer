import type { DuckDBType, DuckDBValue } from '@duckdb/node-api';

import type { DatabaseRow, IDatabaseAdapter, QueryParams, QueryResult } from './IDatabaseAdapter';

export class MockAdapter implements IDatabaseAdapter {
  private tables = new Map<string, Record<string, unknown>[]>();

  constructor(private readonly dbPath = ':memory:') {}

  getDbPath(): string {
    return this.dbPath;
  }

  async query<T extends DatabaseRow = DatabaseRow>(
    sql: string,
    params?: QueryParams,
    types?: DuckDBType[] | Record<string, DuckDBType>
  ): Promise<QueryResult<T>> {
    await Promise.resolve(); // Simulate async operation
    console.log('MockAdapter: query executed', { sql, params, types });

    // Simple SQL parsing for basic operations
    const sqlLower = sql.toLowerCase();
    if (sqlLower.startsWith('insert')) {
      const tableName = this.extractTableName(sql);
      const table = this.tables.get(tableName) ?? [];
      const newRow = this.createRow(sql, params as DuckDBValue[]);
      table.push(newRow);
      this.tables.set(tableName, table);
      return [newRow] as T[];
    }

    if (sqlLower.startsWith('select')) {
      const tableName = this.extractTableName(sql);
      return (this.tables.get(tableName) ?? []) as T[];
    }

    return [] as T[];
  }

  close(): Promise<void> {
    console.log('MockAdapter: connection closed');
    return Promise.resolve();
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    console.log('MockAdapter: BEGIN TRANSACTION');
    // Create snapshot of current state
    const snapshot = new Map(this.tables);
    try {
      const result = await callback();
      console.log('MockAdapter: COMMIT');
      return result;
    } catch (error) {
      // Restore from snapshot on error
      this.tables = snapshot;
      console.log('MockAdapter: ROLLBACK');
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async init(): Promise<void> {
    await Promise.resolve(); // Simulate async operation
    console.log('MockAdapter: initialized');
    this.tables.clear();
  }

  private extractTableName(sql: string): string {
    // Very simple extraction - just for mock purposes
    const match = /(?:from|into)\s+(\w+)/i.exec(sql);
    return match?.[1] ?? 'unknown_table';
  }

  private createRow(_sql: string, params: DuckDBValue[] = []): Record<string, unknown> {
    // Very simple row creation - just for mock purposes
    const row: Record<string, unknown> = { id: crypto.randomUUID() };
    if (params.length > 0) {
      params.forEach((value, index) => {
        row[`param${String(index)}`] = value;
      });
    }
    return row;
  }
}
