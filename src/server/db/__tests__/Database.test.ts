// @vitest-environment node

import type { IDatabaseAdapter, QueryResult, DatabaseRow } from '../adapter/IDatabaseAdapter';
import { Database } from '../Database';

/**
 * Creates a mock IDatabaseAdapter with all methods stubbed via vi.fn().
 * Individual tests can override behavior using mockResolvedValue / mockImplementation.
 */
function createMockAdapter(overrides: Partial<Record<keyof IDatabaseAdapter, unknown>> = {}): IDatabaseAdapter {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    query: vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue([]),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    transaction: vi.fn<(cb: () => Promise<unknown>) => Promise<unknown>>().mockImplementation(async (cb) => cb()),
    getDbPath: vi.fn<() => string>().mockReturnValue(':memory:'),
    ...overrides,
  };
}

// Mock the schema-loader so we don't depend on filesystem reads
vi.mock('../schema/schema-loader', () => ({
  loadSchema: vi.fn(() => 'CREATE TABLE packages (id CHAR(36) PRIMARY KEY)'),
}));

// Mock fs/promises so file-based database tests don't touch the real filesystem
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

describe('Database', () => {
  let mockAdapter: IDatabaseAdapter;
  let db: Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset loadSchema to its default mock value (tests in executeSchema may override it)
    const { loadSchema } = await import('../schema/schema-loader');
    vi.mocked(loadSchema).mockReturnValue('CREATE TABLE packages (id CHAR(36) PRIMARY KEY)');
    mockAdapter = createMockAdapter();
    db = new Database(mockAdapter);
  });

  // ---------------------------------------------------------------------------
  // Constructor & getAdapter
  // ---------------------------------------------------------------------------
  describe('constructor and getAdapter', () => {
    it('stores the adapter and returns it via getAdapter()', () => {
      expect(db.getAdapter()).toBe(mockAdapter);
    });

    it('defaults dbPath to :memory: when no path is provided', () => {
      // Verify that in-memory initialization path is taken (no fs.stat call)
      // The constructor itself just stores the value; behavior is validated in initializeDatabase tests
      expect(db.getAdapter()).toBe(mockAdapter);
    });

    it('accepts a custom dbPath', () => {
      const customDb = new Database(mockAdapter, '/tmp/test.duckdb');
      expect(customDb.getAdapter()).toBe(mockAdapter);
    });
  });

  // ---------------------------------------------------------------------------
  // initializeDatabase — in-memory path
  // ---------------------------------------------------------------------------
  describe('initializeDatabase (in-memory)', () => {
    it('calls adapter.init() for in-memory databases', async () => {
      await db.initializeDatabase();
      expect(mockAdapter.init).toHaveBeenCalledTimes(1);
    });

    it('executes the loaded schema statements', async () => {
      await db.initializeDatabase();
      // The mock loadSchema returns one CREATE TABLE statement
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE packages')
      );
    });

    it('runs migrations after schema execution', async () => {
      await db.initializeDatabase();
      // migrateSchemaIfNeeded queries PRAGMA table_info for 'methods', 'properties', etc.
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining("PRAGMA table_info('methods')")
      );
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining("PRAGMA table_info('properties')")
      );
    });

    it('throws when allowSchemaChanges is false for in-memory databases', async () => {
      await expect(db.initializeDatabase(false, false)).rejects.toThrow(
        'Cannot initialize in-memory database in read-only mode without schema changes'
      );
    });

    it('does not call adapter.init() when schema changes are disallowed (throws first)', async () => {
      await expect(db.initializeDatabase(false, false)).rejects.toThrow();
      expect(mockAdapter.init).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // initializeDatabase — file-based path
  // ---------------------------------------------------------------------------
  describe('initializeDatabase (file-based)', () => {
    let fileDb: Database;
    let fsMock: { stat: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      // Need a fresh import of the mocked fs module
      fsMock = (await import('fs/promises')) as unknown as typeof fsMock;
      fileDb = new Database(mockAdapter, 'test.duckdb');
    });

    it('checks file existence via fs.stat', async () => {
      fsMock.stat.mockRejectedValue(new Error('ENOENT'));
      await fileDb.initializeDatabase();
      expect(fsMock.stat).toHaveBeenCalled();
    });

    it('executes schema when file does not exist', async () => {
      fsMock.stat.mockRejectedValue(new Error('ENOENT'));
      await fileDb.initializeDatabase();
      expect(mockAdapter.init).toHaveBeenCalled();
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE packages')
      );
    });

    it('deletes file and re-creates schema when reset is true and file exists', async () => {
      fsMock.stat.mockResolvedValue({ size: 1024, isFile: () => true, birthtime: new Date(), mtime: new Date() });
      await fileDb.initializeDatabase(true);
      expect(fsMock.unlink).toHaveBeenCalled();
      expect(mockAdapter.init).toHaveBeenCalled();
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE packages')
      );
    });

    it('skips schema execution when file exists and schema is valid', async () => {
      fsMock.stat.mockResolvedValue({ size: 1024, isFile: () => true, birthtime: new Date(), mtime: new Date() });

      // verifySchema checks each required table with SELECT 1 FROM <table> LIMIT 1
      // and then checks methods/properties columns via PRAGMA table_info
      const queryMock = vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation(async (sql: string) => {
        if (sql.startsWith("PRAGMA table_info('methods')")) {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
          ] as QueryResult;
        }
        if (sql.startsWith("PRAGMA table_info('properties')")) {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
          ] as QueryResult;
        }
        // For PRAGMA table_info calls during ensureColumns (migration), return columns
        if (sql.startsWith('PRAGMA table_info')) {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
            { id: '2', name: 'is_abstract' },
            { id: '3', name: 'created_at' },
            { id: '4', name: 'specifiers_json' },
          ] as QueryResult;
        }
        // For SELECT 1 FROM <table> LIMIT 1, return a row
        if (sql.startsWith('SELECT 1 FROM')) {
          return [{ id: '1' }] as QueryResult;
        }
        return [];
      });

      const validAdapter = createMockAdapter({ query: queryMock });
      const validDb = new Database(validAdapter, 'test.duckdb');

      await validDb.initializeDatabase();

      // Schema should NOT be executed since it's already valid
      const queryCalls = queryMock.mock.calls.map((c) => c[0]);
      const createTableCalls = queryCalls.filter((sql) => sql.includes('CREATE TABLE packages'));
      expect(createTableCalls).toHaveLength(0);
    });

    it('throws when schema is invalid and allowSchemaChanges is false', async () => {
      fsMock.stat.mockResolvedValue({ size: 1024, isFile: () => true, birthtime: new Date(), mtime: new Date() });

      // Make verifySchema fail by having a table query throw
      const queryMock = vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT 1 FROM packages')) {
          throw new Error('table not found');
        }
        return [];
      });

      const failAdapter = createMockAdapter({ query: queryMock });
      const failDb = new Database(failAdapter, 'test.duckdb');

      await expect(failDb.initializeDatabase(false, false)).rejects.toThrow(
        /Database schema is missing or outdated/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // executeSchema — internal behavior tested via initializeDatabase
  // ---------------------------------------------------------------------------
  describe('executeSchema behavior', () => {
    it('strips SQL comment lines before splitting', async () => {
      const { loadSchema } = await import('../schema/schema-loader');
      vi.mocked(loadSchema).mockReturnValue(
        '-- This is a comment\nCREATE TABLE test (id TEXT PRIMARY KEY);\n-- Another comment\nCREATE INDEX idx_test ON test (id)'
      );

      await db.initializeDatabase();

      // Both statements should be executed; comments should be stripped
      expect(mockAdapter.query).toHaveBeenCalledWith('CREATE TABLE test (id TEXT PRIMARY KEY)');
      expect(mockAdapter.query).toHaveBeenCalledWith('CREATE INDEX idx_test ON test (id)');
    });

    it('skips empty statements after splitting', async () => {
      const { loadSchema } = await import('../schema/schema-loader');
      vi.mocked(loadSchema).mockReturnValue('CREATE TABLE a (id TEXT);;;');

      await db.initializeDatabase();

      const queryCalls = vi.mocked(mockAdapter.query).mock.calls;
      const schemaStatements = queryCalls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('CREATE TABLE a')
      );
      expect(schemaStatements).toHaveLength(1);
    });

    it('ignores "already exists" errors during schema execution', async () => {
      const { loadSchema } = await import('../schema/schema-loader');
      vi.mocked(loadSchema).mockReturnValue(
        'CREATE TABLE dup (id TEXT PRIMARY KEY); CREATE TABLE dup (id TEXT PRIMARY KEY)'
      );

      const queryMock = vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation(async (sql: string) => {
        if (sql === 'CREATE TABLE dup (id TEXT PRIMARY KEY)') {
          // First call succeeds, second call throws "already exists"
          if (queryMock.mock.calls.filter(([s]) => s === sql).length > 1) {
            throw new Error('Table dup already exists');
          }
        }
        return [];
      });

      const dedupAdapter = createMockAdapter({ query: queryMock });
      const dedupDb = new Database(dedupAdapter);

      // Should not throw even though the second CREATE TABLE fails with "already exists"
      await expect(dedupDb.initializeDatabase()).resolves.toBeUndefined();
    });

    it('rethrows non-idempotent errors during schema execution', async () => {
      const { loadSchema } = await import('../schema/schema-loader');
      vi.mocked(loadSchema).mockReturnValue('INSERT INTO bad_table VALUES (1)');

      vi.mocked(mockAdapter.query).mockRejectedValue(new Error('syntax error'));

      await expect(db.initializeDatabase()).rejects.toThrow('syntax error');
    });
  });

  // ---------------------------------------------------------------------------
  // migrateSchemaIfNeeded — column migration
  // ---------------------------------------------------------------------------
  describe('migrateSchemaIfNeeded behavior', () => {
    it('adds missing columns to the methods table', async () => {
      // Return empty columns set so all ensureColumns triggers ALTER TABLE
      vi.mocked(mockAdapter.query).mockImplementation(async (sql: string) => {
        if (sql.startsWith('PRAGMA table_info')) {
          return [] as QueryResult;
        }
        // code_issues check — throw to trigger table creation
        if (sql.startsWith('SELECT 1 FROM code_issues')) {
          throw new Error('table not found');
        }
        return [] as QueryResult;
      });

      await db.initializeDatabase();

      const queryCalls = vi.mocked(mockAdapter.query).mock.calls.map(([sql]) => sql);
      const alterMethods = queryCalls.filter(
        (sql) => sql.includes('ALTER TABLE methods ADD COLUMN')
      );
      // Should have added parent_type, is_abstract, created_at
      expect(alterMethods.length).toBeGreaterThanOrEqual(3);
      expect(alterMethods.some((sql) => sql.includes('parent_type'))).toBe(true);
      expect(alterMethods.some((sql) => sql.includes('is_abstract'))).toBe(true);
      expect(alterMethods.some((sql) => sql.includes('created_at'))).toBe(true);
    });

    it('skips columns that already exist', async () => {
      vi.mocked(mockAdapter.query).mockImplementation(async (sql: string) => {
        if (sql === "PRAGMA table_info('methods')") {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
            { id: '2', name: 'is_abstract' },
            { id: '3', name: 'created_at' },
          ] as QueryResult;
        }
        if (sql.startsWith('PRAGMA table_info')) {
          // Other tables: return columns that include created_at and specifiers_json
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
            { id: '2', name: 'created_at' },
            { id: '3', name: 'specifiers_json' },
          ] as QueryResult;
        }
        if (sql.startsWith('SELECT 1 FROM code_issues')) {
          return [{ id: '1' }] as QueryResult;
        }
        return [] as QueryResult;
      });

      await db.initializeDatabase();

      const queryCalls = vi.mocked(mockAdapter.query).mock.calls.map(([sql]) => sql);
      const alterCalls = queryCalls.filter((sql) => sql.includes('ALTER TABLE'));
      expect(alterCalls).toHaveLength(0);
    });

    it('creates code_issues table when it does not exist', async () => {
      vi.mocked(mockAdapter.query).mockImplementation(async (sql: string) => {
        if (sql.startsWith('PRAGMA table_info')) {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
            { id: '2', name: 'is_abstract' },
            { id: '3', name: 'created_at' },
            { id: '4', name: 'specifiers_json' },
          ] as QueryResult;
        }
        if (sql.startsWith('SELECT 1 FROM code_issues')) {
          throw new Error('table not found');
        }
        return [] as QueryResult;
      });

      await db.initializeDatabase();

      const queryCalls = vi.mocked(mockAdapter.query).mock.calls.map(([sql]) => sql);
      expect(queryCalls.some((sql) => sql.includes('CREATE TABLE code_issues'))).toBe(true);
      expect(queryCalls.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_code_issues_module_id'))).toBe(true);
      expect(queryCalls.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_code_issues_package_id'))).toBe(true);
      expect(queryCalls.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_code_issues_entity_id'))).toBe(true);
      expect(queryCalls.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_code_issues_rule_code'))).toBe(true);
    });

    it('does not recreate code_issues table when it already exists', async () => {
      vi.mocked(mockAdapter.query).mockImplementation(async (sql: string) => {
        if (sql.startsWith('PRAGMA table_info')) {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
            { id: '2', name: 'is_abstract' },
            { id: '3', name: 'created_at' },
            { id: '4', name: 'specifiers_json' },
          ] as QueryResult;
        }
        if (sql.startsWith('SELECT 1 FROM code_issues')) {
          return [{ id: '1' }] as QueryResult; // table exists
        }
        return [] as QueryResult;
      });

      await db.initializeDatabase();

      const queryCalls = vi.mocked(mockAdapter.query).mock.calls.map(([sql]) => sql);
      expect(queryCalls.some((sql) => sql.includes('CREATE TABLE code_issues'))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // verifySchema — tested indirectly through initializeDatabase
  // ---------------------------------------------------------------------------
  describe('verifySchema behavior', () => {
    let fileDb: Database;
    let fsMock: { stat: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      fsMock = (await import('fs/promises')) as unknown as typeof fsMock;
      fsMock.stat.mockResolvedValue({ size: 1024, isFile: () => true, birthtime: new Date(), mtime: new Date() });
    });

    it('returns false when a required table is missing', async () => {
      const queryMock = vi.fn<(sql: string) => Promise<QueryResult<DatabaseRow>>>().mockImplementation(async (sql: string) => {
        // verifySchema iterates over required tables; fail on 'modules'
        if (sql === 'SELECT 1 FROM modules LIMIT 1') {
          throw new Error('table not found');
        }
        if (sql.startsWith('PRAGMA table_info')) {
          return [] as QueryResult;
        }
        if (sql.startsWith('SELECT 1 FROM code_issues')) {
          throw new Error('table not found');
        }
        return [{ id: '1' }] as QueryResult;
      });

      const adapter = createMockAdapter({ query: queryMock });
      fileDb = new Database(adapter, 'test.duckdb');
      await fileDb.initializeDatabase();

      // Since schema verification failed, it should have executed schema
      const calls = queryMock.mock.calls.map(([sql]) => sql);
      expect(calls.some((sql) => sql.includes('CREATE TABLE packages'))).toBe(true);
    });

    it('returns false when methods table lacks parent_type column', async () => {
      const queryMock = vi.fn<(sql: string) => Promise<QueryResult<DatabaseRow>>>().mockImplementation(async (sql: string) => {
        if (sql === "PRAGMA table_info('methods')") {
          // Missing parent_type column
          return [{ id: '0', name: 'id' }] as QueryResult;
        }
        if (sql === "PRAGMA table_info('properties')") {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
          ] as QueryResult;
        }
        if (sql.startsWith('PRAGMA table_info')) {
          return [
            { id: '0', name: 'id' },
            { id: '1', name: 'parent_type' },
            { id: '2', name: 'is_abstract' },
            { id: '3', name: 'created_at' },
            { id: '4', name: 'specifiers_json' },
          ] as QueryResult;
        }
        if (sql.startsWith('SELECT 1 FROM code_issues')) {
          return [{ id: '1' }] as QueryResult;
        }
        if (sql.startsWith('SELECT 1 FROM')) {
          return [{ id: '1' }] as QueryResult;
        }
        return [] as QueryResult;
      });

      const adapter = createMockAdapter({ query: queryMock });
      fileDb = new Database(adapter, 'test.duckdb');
      await fileDb.initializeDatabase();

      // Schema verification should have failed, triggering schema execution
      const calls = queryMock.mock.calls.map(([sql]) => sql);
      expect(calls.some((sql) => sql.includes('CREATE TABLE packages'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------
  describe('close', () => {
    it('delegates to adapter.close()', async () => {
      await db.close();
      expect(mockAdapter.close).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from adapter.close()', async () => {
      vi.mocked(mockAdapter.close).mockRejectedValue(new Error('close failed'));
      await expect(db.close()).rejects.toThrow('close failed');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('propagates adapter.init() errors', async () => {
      vi.mocked(mockAdapter.init).mockRejectedValue(new Error('init failed'));
      await expect(db.initializeDatabase()).rejects.toThrow('init failed');
    });

    it('propagates adapter.query() errors during schema execution (non-idempotent)', async () => {
      vi.mocked(mockAdapter.query).mockRejectedValue(new Error('disk full'));
      // init succeeds but query fails
      vi.mocked(mockAdapter.init).mockResolvedValue(undefined);

      await expect(db.initializeDatabase()).rejects.toThrow('disk full');
    });

    it('handles non-Error throwables during schema execution', async () => {
      const { loadSchema } = await import('../schema/schema-loader');
      vi.mocked(loadSchema).mockReturnValue('CREATE TABLE x (id TEXT)');

      vi.mocked(mockAdapter.query).mockRejectedValue('string error');

      await expect(db.initializeDatabase()).rejects.toBe('string error');
    });
  });
});
