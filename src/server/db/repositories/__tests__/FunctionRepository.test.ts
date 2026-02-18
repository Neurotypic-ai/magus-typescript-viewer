import { ModuleFunction } from '../../../../shared/types/Function';
import { RepositoryError } from '../../errors/RepositoryError';
import { FunctionRepository } from '../FunctionRepository';

import type { IFunctionCreateDTO, IFunctionRow } from '../FunctionRepository';
import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';

/**
 * Creates a mock IDatabaseAdapter with vi.fn() stubs for every method.
 */
function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
  };
}

/**
 * Returns a realistic IFunctionRow as DuckDB would return it.
 */
function makeFunctionRow(overrides: Partial<IFunctionRow> = {}): IFunctionRow {
  return {
    id: 'func-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    name: 'myFunction',
    return_type: 'string',
    is_async: 'true',
    is_exported: 'true',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Helper to build a minimal IFunctionCreateDTO.
 */
function makeCreateDTO(overrides: Partial<IFunctionCreateDTO> = {}): IFunctionCreateDTO {
  return {
    id: 'func-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    name: 'myFunction',
    return_type: 'string',
    is_async: true,
    is_exported: true,
    ...overrides,
  };
}

describe('FunctionRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: FunctionRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new FunctionRepository(adapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should insert a function and return a ModuleFunction', async () => {
      const row = makeFunctionRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create(makeCreateDTO());

      expect(result).toBeInstanceOf(ModuleFunction);
      expect(result.id).toBe('func-uuid-1');
      expect(result.package_id).toBe('pkg-uuid-1');
      expect(result.module_id).toBe('mod-uuid-1');
      expect(result.name).toBe('myFunction');
      expect(result.return_type).toBe('string');
      expect(result.is_async).toBe(true);
      expect(result.is_exported).toBe(true);

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO functions');
      expect(sql).toContain('RETURNING *');
      expect(params).toEqual([
        'func-uuid-1',
        'pkg-uuid-1',
        'mod-uuid-1',
        'myFunction',
        'string',
        true,
        true,
        false, // has_explicit_return_type defaults to false
      ]);
    });

    it('should default optional fields when not provided', async () => {
      const row = makeFunctionRow({ return_type: null, is_async: 'false', is_exported: 'false' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const dto = makeCreateDTO({
        return_type: undefined,
        is_async: undefined,
        is_exported: undefined,
      });
      const result = await repo.create(dto);

      const [, params] = vi.mocked(adapter.query).mock.calls[0]!;
      // return_type defaults to null, is_async/is_exported default to false
      expect(params).toEqual([
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        null,
        false,
        false,
        false,
      ]);

      expect(result.return_type).toBe('void'); // null return_type maps to 'void'
      expect(result.is_async).toBe(false);
      expect(result.is_exported).toBe(false);
    });

    it('should throw RepositoryError when insert returns empty result', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when adapter throws', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('connection lost'));

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------
  describe('findById', () => {
    it('should return a ModuleFunction when found', async () => {
      const row = makeFunctionRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result).toBeInstanceOf(ModuleFunction);
      expect(result?.id).toBe('func-uuid-1');
      expect(result?.name).toBe('myFunction');

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM functions WHERE id = ?');
      expect(params).toEqual(['func-uuid-1']);
    });

    it('should return undefined when no row is found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.findById('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should throw RepositoryError when adapter throws', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('db error'));

      await expect(repo.findById('func-uuid-1')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveById (alias)
  // ---------------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should delegate to findById', async () => {
      const row = makeFunctionRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('func-uuid-1');

      expect(result).toBeInstanceOf(ModuleFunction);
      expect(result?.id).toBe('func-uuid-1');
    });
  });

  // ---------------------------------------------------------------------------
  // findByModuleId
  // ---------------------------------------------------------------------------
  describe('findByModuleId', () => {
    it('should return all functions for a module', async () => {
      const rows = [
        makeFunctionRow({ id: 'func-1', name: 'alpha' }),
        makeFunctionRow({ id: 'func-2', name: 'beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.findByModuleId('mod-uuid-1');

      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(ModuleFunction);
      expect(results[0]?.name).toBe('alpha');
      expect(results[1]?.name).toBe('beta');

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id = ?');
      expect(sql).toContain('ORDER BY name');
      expect(params).toEqual(['mod-uuid-1']);
    });

    it('should return empty array when no functions exist for module', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.findByModuleId('mod-uuid-empty');

      expect(results).toEqual([]);
    });

    it('should throw RepositoryError when adapter throws', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('db error'));

      await expect(repo.findByModuleId('mod-uuid-1')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByModuleId (alias)
  // ---------------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should delegate to findByModuleId', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieveByModuleId('mod-uuid-1');

      expect(results).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByModuleIds
  // ---------------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('should return functions for multiple module IDs', async () => {
      const rows = [
        makeFunctionRow({ id: 'func-1', module_id: 'mod-1', name: 'alpha' }),
        makeFunctionRow({ id: 'func-2', module_id: 'mod-2', name: 'beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleIds(['mod-1', 'mod-2']);

      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(ModuleFunction);

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id IN (?, ?)');
      expect(params).toEqual(['mod-1', 'mod-2']);
    });

    it('should return empty array when given empty moduleIds', async () => {
      const results = await repo.retrieveByModuleIds([]);

      expect(results).toEqual([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should throw RepositoryError when adapter throws', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('db error'));

      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve (all)
  // ---------------------------------------------------------------------------
  describe('retrieve', () => {
    it('should return all functions ordered by name', async () => {
      const rows = [
        makeFunctionRow({ id: 'func-1', name: 'alpha' }),
        makeFunctionRow({ id: 'func-2', name: 'beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('alpha');

      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM functions ORDER BY name');
    });

    it('should return empty array when table is empty', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieve();

      expect(results).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should update specified fields and return updated ModuleFunction', async () => {
      const updatedRow = makeFunctionRow({ name: 'renamedFunction', is_async: 'false' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('func-uuid-1', {
        name: 'renamedFunction',
        is_async: false,
      });

      expect(result).toBeInstanceOf(ModuleFunction);
      expect(result.name).toBe('renamedFunction');
      expect(result.is_async).toBe(false);

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('UPDATE functions SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('is_async = ?');
      expect(sql).toContain('WHERE id = ?');
      expect(sql).toContain('RETURNING *');
      expect(params).toEqual(['renamedFunction', false, 'func-uuid-1']);
    });

    it('should update only return_type when only return_type is provided', async () => {
      const updatedRow = makeFunctionRow({ return_type: 'number' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('func-uuid-1', { return_type: 'number' });

      expect(result.return_type).toBe('number');

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('return_type = ?');
      expect(params).toEqual(['number', 'func-uuid-1']);
    });

    it('should update only is_exported when only is_exported is provided', async () => {
      const updatedRow = makeFunctionRow({ is_exported: 'false' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('func-uuid-1', { is_exported: false });

      expect(result.is_exported).toBe(false);

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('is_exported = ?');
      expect(params).toEqual([false, 'func-uuid-1']);
    });

    it('should return existing entity when no fields are provided (empty DTO)', async () => {
      const existingRow = makeFunctionRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([existingRow]);

      const result = await repo.update('func-uuid-1', {});

      expect(result).toBeInstanceOf(ModuleFunction);
      expect(result.id).toBe('func-uuid-1');

      // The query should be a SELECT (from findById), not an UPDATE
      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM functions WHERE id = ?');
    });

    it('should throw RepositoryError when no fields provided and entity not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('nonexistent', {})).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when update returns empty result', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(
        repo.update('nonexistent', { name: 'newName' })
      ).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when adapter throws', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('db error'));

      await expect(
        repo.update('func-uuid-1', { name: 'newName' })
      ).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('should execute a DELETE query with the given id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('func-uuid-1');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('DELETE FROM functions WHERE id = ?');
      expect(params).toEqual(['func-uuid-1']);
    });

    it('should throw RepositoryError when adapter throws', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('db error'));

      await expect(repo.delete('func-uuid-1')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // createBatch
  // ---------------------------------------------------------------------------
  describe('createBatch', () => {
    it('should batch-insert multiple functions in a single query', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const items: IFunctionCreateDTO[] = [
        makeCreateDTO({ id: 'func-1', name: 'alpha' }),
        makeCreateDTO({ id: 'func-2', name: 'beta' }),
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO functions');
      expect(sql).toContain('(?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)');
      // 2 items x 8 columns = 16 params
      expect(params).toHaveLength(16);
    });

    it('should do nothing when given an empty array', async () => {
      await repo.createBatch([]);

      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should fall back to individual inserts on duplicate errors', async () => {
      // First call (batch) fails with duplicate error
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate key'))
        // Individual inserts: first succeeds, second fails with duplicate, third succeeds
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Duplicate key'))
        .mockResolvedValueOnce([]);

      const items: IFunctionCreateDTO[] = [
        makeCreateDTO({ id: 'func-1', name: 'alpha' }),
        makeCreateDTO({ id: 'func-2', name: 'beta' }),
        makeCreateDTO({ id: 'func-3', name: 'gamma' }),
      ];

      await repo.createBatch(items);

      // 1 batch call + 3 individual insert calls
      expect(adapter.query).toHaveBeenCalledTimes(4);
    });

    it('should rethrow non-duplicate errors from batch insert', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('connection lost'));

      const items: IFunctionCreateDTO[] = [makeCreateDTO()];

      await expect(repo.createBatch(items)).rejects.toThrow('connection lost');
    });
  });

  // ---------------------------------------------------------------------------
  // mapToEntity (via public methods)
  // ---------------------------------------------------------------------------
  describe('entity mapping', () => {
    it('should map is_async "1" as true', async () => {
      const row = makeFunctionRow({ is_async: '1' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.is_async).toBe(true);
    });

    it('should map is_async "false" as false', async () => {
      const row = makeFunctionRow({ is_async: 'false' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.is_async).toBe(false);
    });

    it('should map is_exported "1" as true', async () => {
      const row = makeFunctionRow({ is_exported: '1' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.is_exported).toBe(true);
    });

    it('should map is_exported "false" as false', async () => {
      const row = makeFunctionRow({ is_exported: 'false' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.is_exported).toBe(false);
    });

    it('should map null return_type to "void"', async () => {
      const row = makeFunctionRow({ return_type: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.return_type).toBe('void');
    });

    it('should parse created_at as a Date', async () => {
      const row = makeFunctionRow({ created_at: '2025-06-15T12:30:00.000Z' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.created_at).toBeInstanceOf(Date);
      expect(result?.created_at.toISOString()).toBe('2025-06-15T12:30:00.000Z');
    });

    it('should initialize parameters as an empty Map', async () => {
      const row = makeFunctionRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.findById('func-uuid-1');

      expect(result?.parameters).toBeInstanceOf(Map);
      expect(result?.parameters.size).toBe(0);
    });
  });
});
