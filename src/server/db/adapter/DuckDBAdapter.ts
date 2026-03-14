import { AsyncLocalStorage } from 'node:async_hooks';

import type { DuckDBConnection, DuckDBInstance, DuckDBValue } from '@duckdb/node-api';

import type { DatabaseRow, IDatabaseAdapter, QueryParams, QueryResult } from './IDatabaseAdapter';

interface DuckDBTimestampValue {
  micros: bigint | number;
}

function isDuckDBRow(row: unknown): row is unknown[] {
  return Array.isArray(row);
}

function isTimestampValue(value: unknown): value is DuckDBTimestampValue {
  return typeof value === 'object' && value !== null && 'micros' in value;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (isTimestampValue(value)) {
    const milliseconds = Number(value.micros) / 1000;
    return new Date(milliseconds).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  return value;
}

function toStringId(value: unknown): string {
  if (value === null || value === undefined) {
    throw new Error('Row is missing required id field');
  }
  const normalized = normalizeValue(value);
  if (typeof normalized === 'string') {
    return normalized;
  }
  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return String(normalized);
  }
  return JSON.stringify(normalized);
}

function convertToRow(duckDBRow: unknown, columnNames: string[]): DatabaseRow {
  if (!isDuckDBRow(duckDBRow)) {
    throw new Error('Invalid row format from DuckDB');
  }

  // DuckDB returns rows as arrays, with column names in the metadata
  const id = duckDBRow[0];

  return {
    id: toStringId(id),
    ...Object.fromEntries(
      duckDBRow
        .slice(1)
        .map((value, index) => [
          columnNames[index + 1] ?? `column_${(index + 1).toString()}`,
          value !== null ? normalizeValue(value) : null,
        ])
    ),
  };
}

export class DuckDBAdapter implements IDatabaseAdapter {
  private db!: DuckDBInstance;
  private availableConnections: DuckDBConnection[] = [];
  private waitingForConnection: { resolve: (conn: DuckDBConnection) => void; reject: (err: Error) => void }[] = [];
  private isInitialized = false;
  private isClosing = false;
  private readonly poolSize: number;
  private readonly transactionConnection = new AsyncLocalStorage<DuckDBConnection>();

  constructor(
    private readonly dbPath: string,
    private readonly config?: { allowWrite?: boolean; threads?: number; poolSize?: number }
  ) {
    this.poolSize = config?.poolSize ?? 4;
  }

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const duckdb = await import('@duckdb/node-api');

    this.db = await duckdb.DuckDBInstance.create(this.dbPath, {
      access_mode: this.config?.allowWrite ? 'READ_WRITE' : 'READ_ONLY',
      threads: this.config?.threads ? this.config.threads.toString() : '8',
    });

    for (let i = 0; i < this.poolSize; i++) {
      const connection = await this.db.connect();
      this.availableConnections.push(connection);
    }

    this.isInitialized = true;
  }

  private acquireConnection(): Promise<DuckDBConnection> {
    if (this.isClosing) {
      return Promise.reject(new Error('Database is closing'));
    }
    const available = this.availableConnections.pop();
    if (available) {
      return Promise.resolve(available);
    }
    return new Promise<DuckDBConnection>((resolve, reject) => {
      this.waitingForConnection.push({ resolve, reject });
    });
  }

  private releaseConnection(connection: DuckDBConnection): void {
    const waiter = this.waitingForConnection.shift();
    if (waiter) {
      waiter.resolve(connection);
    } else {
      this.availableConnections.push(connection);
    }
  }

  private async executeOnConnection<T extends DatabaseRow>(
    connection: DuckDBConnection,
    sql: string,
    params?: QueryParams
  ): Promise<QueryResult<T>> {
    const queryParams = (params ?? []) as DuckDBValue[];
    const result = await connection.runAndReadAll(sql, queryParams);

    if (typeof result.columnNames !== 'function' || typeof result.getRows !== 'function') {
      throw new Error('Invalid result from DuckDB query');
    }

    const columnNames = result.columnNames();
    const rows = result.getRows();
    if (!Array.isArray(rows)) {
      throw new Error('Invalid rows format from DuckDB query');
    }

    return rows.map((row: unknown) => convertToRow(row, columnNames)) as T[];
  }

  getDbPath(): string {
    return this.dbPath;
  }

  async query<T extends DatabaseRow = DatabaseRow>(sql: string, params?: QueryParams): Promise<QueryResult<T>> {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call init() first.');
    }

    // If we're inside a transaction, use its dedicated connection
    const txnConnection = this.transactionConnection.getStore();
    if (txnConnection) {
      try {
        return await this.executeOnConnection<T>(txnConnection, sql, params);
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    // Otherwise acquire from pool
    const connection = await this.acquireConnection();
    try {
      return await this.executeOnConnection<T>(connection, sql, params);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      this.releaseConnection(connection);
    }
  }

  async close(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.isClosing = true;

    // Reject any waiting connection requests with a proper error
    for (const waiter of this.waitingForConnection) {
      waiter.reject(new Error('Database is closing'));
    }
    this.waitingForConnection.length = 0;

    // Close all available connections
    for (const connection of this.availableConnections) {
      connection.disconnectSync();
    }
    this.availableConnections.length = 0;

    this.isInitialized = false;
    this.isClosing = false;
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const connection = await this.acquireConnection();
    try {
      await connection.run('BEGIN TRANSACTION');
      // Run the callback with this connection bound via AsyncLocalStorage
      // so all query() calls inside route through the transaction's connection
      const result = await this.transactionConnection.run(connection, callback);
      await connection.run('COMMIT');
      return result;
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      this.releaseConnection(connection);
    }
  }
}
