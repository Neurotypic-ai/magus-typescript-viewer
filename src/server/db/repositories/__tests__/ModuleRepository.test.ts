// @vitest-environment node

import { Module } from '../../../../shared/types/Module';
import { RepositoryError } from '../../errors/RepositoryError';
import { ModuleRepository } from '../ModuleRepository';

import type { FileLocation } from '../../../../shared/types/FileLocation';
import type { IDatabaseAdapter, QueryResult } from '../../adapter/IDatabaseAdapter';
import type { IModuleRow } from '../../types/DatabaseResults';
import type { IModuleCreateDTO } from '../ModuleRepository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(overrides: Partial<IDatabaseAdapter> = {}): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
    ...overrides,
  };
}

function createFileLocation(overrides: Partial<FileLocation> = {}): FileLocation {
  return {
    directory: '/src/modules/',
    name: 'TestModule',
    filename: '/src/modules/TestModule.ts',
    relativePath: 'modules/TestModule.ts',
    ...overrides,
  };
}

function createModuleDTO(overrides: Partial<IModuleCreateDTO> = {}): IModuleCreateDTO {
  return {
    id: 'mod-uuid-1',
    package_id: 'pkg-uuid-1',
    name: 'TestModule',
    source: createFileLocation(),
    line_count: 42,
    ...overrides,
  };
}

function createModuleRow(dto: IModuleCreateDTO): IModuleRow {
  return {
    id: dto.id,
    package_id: dto.package_id,
    name: dto.name,
    source: JSON.stringify(dto.source),
    directory: dto.source.directory,
    filename: dto.source.filename,
    relative_path: dto.source.relativePath,
    is_barrel: 0,
    line_count: dto.line_count ?? 0,
    created_at: new Date().toISOString(),
  };
}

/**
 * Safely extract [sql, params] from the nth call to adapter.query,
 * avoiding non-null assertions.
 */
function getQueryCall(adapter: IDatabaseAdapter, callIndex = 0): [string, unknown[]] {
  const calls = vi.mocked(adapter.query).mock.calls;
  const call = calls[callIndex];
  expect(call).toBeDefined();
  const sql = call?.[0] ?? '';
  const params = (call?.[1] ?? []) as unknown[];
  return [sql as string, params];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModuleRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: ModuleRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new ModuleRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('should insert a module and return a Module instance', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.create(dto);

      expect(result).toBeInstanceOf(Module);
      expect(result.id).toBe(dto.id);
      expect(result.package_id).toBe(dto.package_id);
      expect(result.name).toBe(dto.name);
      expect(result.source.directory).toBe(dto.source.directory);
      expect(result.source.filename).toBe(dto.source.filename);
    });

    it('should pass the correct SQL and parameters to the adapter', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = getQueryCall(adapter, 0);

      expect(sql).toContain('INSERT INTO modules');
      expect(sql).toContain('RETURNING *');
      expect(params).toEqual([
        dto.id,
        dto.package_id,
        dto.name,
        JSON.stringify(dto.source),
        dto.source.directory,
        dto.source.filename,
        dto.source.relativePath,
        0, // isBarrel defaults to false -> 0
        dto.line_count,
      ]);
    });

    it('should set isBarrel to 1 when source.isBarrel is true', async () => {
      const dto = createModuleDTO({
        source: createFileLocation({ isBarrel: true }),
      });
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      await repo.create(dto);

      const [, params] = getQueryCall(adapter, 0);
      // isBarrel is the 8th parameter (index 7)
      expect(params[7]).toBe(1);
    });

    it('should default line_count to 0 when not provided', async () => {
      const dto = createModuleDTO({ line_count: undefined });
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      await repo.create(dto);

      const [, params] = getQueryCall(adapter, 0);
      // line_count is the 9th parameter (index 8)
      expect(params[8]).toBe(0);
    });

    it('should throw RepositoryError when query returns empty results', async () => {
      const dto = createModuleDTO();
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when query throws', async () => {
      const dto = createModuleDTO();
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('should not call adapter.query when items array is empty', async () => {
      await repo.createBatch([]);

      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should insert all items in a single batch query', async () => {
      const dto1 = createModuleDTO({ id: 'mod-1', name: 'Mod1' });
      const dto2 = createModuleDTO({ id: 'mod-2', name: 'Mod2' });

      vi.mocked(adapter.query).mockResolvedValue([] as QueryResult);

      await repo.createBatch([dto1, dto2]);

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = getQueryCall(adapter, 0);

      expect(sql).toContain('INSERT INTO modules');
      expect(sql).toContain('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      // Two rows => 18 parameters (9 columns x 2 rows)
      expect(params).toHaveLength(18);
    });

    it('should serialize source as JSON for each item', async () => {
      const dto = createModuleDTO();

      vi.mocked(adapter.query).mockResolvedValue([] as QueryResult);

      await repo.createBatch([dto]);

      const [, params] = getQueryCall(adapter, 0);
      // The 4th param (index 3) should be the JSON-stringified source
      expect(params[3]).toBe(JSON.stringify(dto.source));
    });

    it('should fall back to individual inserts on duplicate key errors', async () => {
      const dto1 = createModuleDTO({ id: 'mod-1', name: 'Mod1' });
      const dto2 = createModuleDTO({ id: 'mod-2', name: 'Mod2' });

      // First call (batch) throws duplicate error
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate key'))
        // Then individual inserts succeed
        .mockResolvedValueOnce([] as QueryResult)
        .mockResolvedValueOnce([] as QueryResult);

      await repo.createBatch([dto1, dto2]);

      // 1 batch attempt + 2 individual inserts = 3 calls
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should skip individual duplicates during fallback insert', async () => {
      const dto1 = createModuleDTO({ id: 'mod-1', name: 'Mod1' });
      const dto2 = createModuleDTO({ id: 'mod-2', name: 'Mod2' });

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint'))
        .mockRejectedValueOnce(new Error('already exists'))
        .mockResolvedValueOnce([] as QueryResult);

      await repo.createBatch([dto1, dto2]);

      // 1 batch + 2 individual (one throws duplicate, one succeeds) = 3
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should throw non-duplicate errors during batch insert', async () => {
      const dto = createModuleDTO();
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Disk full'));

      await expect(repo.createBatch([dto])).rejects.toThrow('Disk full');
    });

    it('should throw non-duplicate errors during fallback individual insert', async () => {
      const dto = createModuleDTO();

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate'))
        .mockRejectedValueOnce(new Error('Disk full'));

      await expect(repo.createBatch([dto])).rejects.toThrow('Disk full');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('should update name and return updated Module', async () => {
      const dto = createModuleDTO();
      const updatedRow = createModuleRow({ ...dto, name: 'UpdatedModule' });

      // First call: the UPDATE query
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);
      // Second call: the retrieve query inside retrieveById -> retrieve
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow] as QueryResult);

      const result = await repo.update(dto.id, { name: 'UpdatedModule' });

      expect(result).toBeInstanceOf(Module);
      expect(result.name).toBe('UpdatedModule');
    });

    it('should build the correct UPDATE SQL with only provided fields', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query)
        .mockResolvedValueOnce([] as QueryResult)
        .mockResolvedValueOnce([row] as QueryResult);

      await repo.update(dto.id, { name: 'NewName' });

      const [sql, params] = getQueryCall(adapter, 0);

      expect(sql).toContain('UPDATE modules SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('WHERE id = ?');
      // values should be: name value, then id
      expect(params).toEqual(['NewName', dto.id]);
    });

    it('should serialize source as JSON in update', async () => {
      const dto = createModuleDTO();
      const newSource = createFileLocation({ directory: '/new/dir/' });
      const row = createModuleRow({ ...dto, source: newSource });

      vi.mocked(adapter.query)
        .mockResolvedValueOnce([] as QueryResult)
        .mockResolvedValueOnce([row] as QueryResult);

      await repo.update(dto.id, { source: newSource });

      const [, params] = getQueryCall(adapter, 0);
      expect(params).toEqual([JSON.stringify(newSource), dto.id]);
    });

    it('should throw RepositoryError when module not found after update', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([] as QueryResult) // UPDATE succeeds
        .mockResolvedValueOnce([] as QueryResult); // retrieve returns empty

      await expect(repo.update('nonexistent-id', { name: 'X' })).rejects.toThrow(RepositoryError);
    });

    it('should rethrow RepositoryError as-is from inner operations', async () => {
      const repoError = new RepositoryError('inner error', 'update', '[ModuleRepository]');
      vi.mocked(adapter.query).mockRejectedValueOnce(repoError);

      await expect(repo.update('id', { name: 'X' })).rejects.toBe(repoError);
    });

    it('should wrap non-RepositoryError in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new TypeError('type error'));

      await expect(repo.update('id', { name: 'X' })).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('should query all modules when no arguments are provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      const result = await repo.retrieve();

      expect(result).toEqual([]);
      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toBe('SELECT * FROM modules');
      expect(params).toEqual([]);
    });

    it('should filter by id when provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.retrieve('mod-1');

      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['mod-1']);
    });

    it('should filter by package_id when module_id is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.retrieve(undefined, 'pkg-1');

      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toContain('WHERE package_id = ?');
      expect(params).toEqual(['pkg-1']);
    });

    it('should filter by both id and package_id when both are provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.retrieve('mod-1', 'pkg-1');

      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toContain('WHERE id = ? AND package_id = ?');
      expect(params).toEqual(['mod-1', 'pkg-1']);
    });

    it('should return Module instances from rows', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieve(dto.id);

      expect(result).toHaveLength(1);
      const firstResult = result[0];
      expect(firstResult).toBeInstanceOf(Module);
      expect(firstResult?.id).toBe(dto.id);
    });

    it('should throw RepositoryError on query failure', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should return a Module when found', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result).toBeInstanceOf(Module);
      expect(result?.id).toBe(dto.id);
    });

    it('should return undefined when not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId (package_id filter)
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should query modules by package_id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.retrieveByModuleId('pkg-1');

      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toContain('WHERE package_id = ?');
      expect(params).toEqual(['pkg-1']);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveAll
  // -----------------------------------------------------------------------
  describe('retrieveAll', () => {
    it('should query all modules when no packageId is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.retrieveAll();

      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toBe('SELECT * FROM modules');
      expect(params).toEqual([]);
    });

    it('should filter by package_id when packageId is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.retrieveAll('pkg-1');

      const [sql, params] = getQueryCall(adapter, 0);
      expect(sql).toContain('WHERE package_id = ?');
      expect(params).toEqual(['pkg-1']);
    });

    it('should return Module instances', async () => {
      const dto1 = createModuleDTO({ id: 'mod-1', name: 'Mod1' });
      const dto2 = createModuleDTO({ id: 'mod-2', name: 'Mod2' });
      const rows = [createModuleRow(dto1), createModuleRow(dto2)];

      vi.mocked(adapter.query).mockResolvedValueOnce(rows as QueryResult);

      const result = await repo.retrieveAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Module);
      expect(result[1]).toBeInstanceOf(Module);
    });

    it('should throw RepositoryError on failure', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('fail'));

      await expect(repo.retrieveAll()).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('should delete related records before deleting the module', async () => {
      vi.mocked(adapter.query).mockResolvedValue([] as QueryResult);

      await repo.delete('mod-1');

      const calls = vi.mocked(adapter.query).mock.calls;

      // Verify cascading deletes happen in correct order
      const deletedTables = calls.map(([sql]) => {
        const match = /DELETE FROM (\w+)/.exec(sql as string);
        return match?.[1];
      });

      expect(deletedTables).toEqual([
        'module_tests',
        'classes',
        'interfaces',
        'methods',
        'properties',
        'parameters',
        'imports',
        'type_aliases',
        'enums',
        'variables',
        'modules',
      ]);
    });

    it('should pass the module id to every delete query', async () => {
      vi.mocked(adapter.query).mockResolvedValue([] as QueryResult);

      await repo.delete('mod-1');

      const calls = vi.mocked(adapter.query).mock.calls;
      for (const [, params] of calls) {
        expect(params).toEqual(['mod-1']);
      }
    });

    it('should throw RepositoryError when a delete query fails', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([] as QueryResult) // module_tests OK
        .mockRejectedValueOnce(new Error('FK constraint')); // classes fails

      await expect(repo.delete('mod-1')).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // createModuleFromRow (private, tested indirectly)
  // -----------------------------------------------------------------------
  describe('row-to-Module mapping', () => {
    it('should parse valid JSON source field', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.source).toEqual(dto.source);
    });

    it('should fall back to denormalized fields when source is null', async () => {
      const dto = createModuleDTO();
      const row: IModuleRow = {
        ...createModuleRow(dto),
        source: null as unknown as string,
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.source.directory).toBe(dto.source.directory);
      expect(result?.source.filename).toBe(dto.source.filename);
      expect(result?.source.relativePath).toBe(dto.source.relativePath);
    });

    it('should fall back to denormalized fields when source is "undefined" string', async () => {
      const dto = createModuleDTO();
      const row: IModuleRow = {
        ...createModuleRow(dto),
        source: 'undefined',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.source.directory).toBe(dto.source.directory);
      expect(result?.source.name).toBe(dto.name);
    });

    it('should fall back to denormalized fields when source is "null" string', async () => {
      const dto = createModuleDTO();
      const row: IModuleRow = {
        ...createModuleRow(dto),
        source: 'null',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.source.directory).toBe(dto.source.directory);
    });

    it('should fall back to denormalized fields when source is invalid JSON', async () => {
      const dto = createModuleDTO();
      const row: IModuleRow = {
        ...createModuleRow(dto),
        source: '{not valid json}',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      // Falls back to denormalized fields
      expect(result?.source.directory).toBe(dto.source.directory);
      expect(result?.source.filename).toBe(dto.source.filename);
    });

    it('should initialize Module with empty Maps for collections', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.classes).toBeInstanceOf(Map);
      expect(result?.interfaces).toBeInstanceOf(Map);
      expect(result?.imports).toBeInstanceOf(Map);
      expect(result?.exports).toBeInstanceOf(Map);
      expect(result?.packages).toBeInstanceOf(Map);
      expect(result?.typeAliases).toBeInstanceOf(Map);
      expect(result?.enums).toBeInstanceOf(Map);
      expect(result?.functions).toBeInstanceOf(Map);
      expect(result?.variables).toBeInstanceOf(Map);
    });

    it('should parse created_at from the row', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);
      const fixedDate = '2024-01-15T10:30:00.000Z';
      row.created_at = fixedDate;

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.created_at).toBeInstanceOf(Date);
      expect(result?.created_at.toISOString()).toBe(fixedDate);
    });

    it('should initialize referencePaths as an empty array', async () => {
      const dto = createModuleDTO();
      const row = createModuleRow(dto);

      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById(dto.id);

      expect(result?.referencePaths).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('should set the table name to "modules"', () => {
      // Access through a method that uses tableName
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      // retrieveAll uses tableName indirectly through executeQuery
      void repo.retrieveAll();

      // Verify through the SQL generated
      const [sql] = getQueryCall(adapter, 0);
      expect(sql).toContain('modules');
    });
  });
});
