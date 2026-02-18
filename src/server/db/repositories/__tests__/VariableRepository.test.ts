// @vitest-environment node
import { Variable } from '../../../../shared/types/Variable';
import { RepositoryError } from '../../errors/RepositoryError';
import { VariableRepository } from '../VariableRepository';

import type { IVariableCreateDTO, IVariableRow } from '../VariableRepository';
import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';

function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
  };
}

const TIMESTAMP = '2025-01-15T12:00:00.000Z';

function makeRow(overrides: Partial<IVariableRow> = {}): IVariableRow {
  return {
    id: 'var-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    name: 'myConst',
    kind: 'const',
    type: 'string',
    initializer: '"hello"',
    created_at: TIMESTAMP,
    ...overrides,
  };
}

function makeCreateDTO(overrides: Partial<IVariableCreateDTO> = {}): IVariableCreateDTO {
  return {
    id: 'var-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    name: 'myConst',
    kind: 'const',
    type: 'string',
    initializer: '"hello"',
    ...overrides,
  };
}

describe('VariableRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: VariableRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new VariableRepository(adapter);
  });

  // ---------- create ----------

  describe('create', () => {
    it('inserts a row and returns a Variable entity', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create(makeCreateDTO());

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO variables');
      expect(sql).toContain('RETURNING *');
      expect(params).toEqual([
        'var-uuid-1',
        'pkg-uuid-1',
        'mod-uuid-1',
        'myConst',
        'const',
        'string',
        '"hello"',
      ]);

      expect(result).toBeInstanceOf(Variable);
      expect(result.id).toBe('var-uuid-1');
      expect(result.name).toBe('myConst');
      expect(result.kind).toBe('const');
      expect(result.type).toBe('string');
      expect(result.initializer).toBe('"hello"');
    });

    it('coerces undefined type and initializer to null in params', async () => {
      const row = makeRow({ type: null, initializer: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      await repo.create(makeCreateDTO({ type: undefined, initializer: undefined }));

      const [, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(params).toEqual([
        'var-uuid-1',
        'pkg-uuid-1',
        'mod-uuid-1',
        'myConst',
        'const',
        null,
        null,
      ]);
    });

    it('throws RepositoryError when INSERT returns no rows', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(RepositoryError);
    });
  });

  // ---------- createBatch ----------

  describe('createBatch', () => {
    it('inserts multiple rows in a single batch query', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const items: IVariableCreateDTO[] = [
        makeCreateDTO({ id: 'v1', name: 'alpha' }),
        makeCreateDTO({ id: 'v2', name: 'beta' }),
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO variables');
      expect(sql).toContain('(?, ?, ?, ?, ?, ?, ?)');
      // Two rows = 14 params
      expect(params).toHaveLength(14);
    });

    it('does nothing when given an empty array', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('falls back to individual inserts on duplicate key error', async () => {
      const items: IVariableCreateDTO[] = [
        makeCreateDTO({ id: 'v1', name: 'alpha' }),
        makeCreateDTO({ id: 'v2', name: 'beta' }),
      ];

      // First batch call fails with UNIQUE error
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        // Individual inserts succeed
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual fallback inserts
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });
  });

  // ---------- update ----------

  describe('update', () => {
    it('builds SET clause from provided fields and returns updated entity', async () => {
      const updatedRow = makeRow({ name: 'renamed', kind: 'let' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('var-uuid-1', { name: 'renamed', kind: 'let' });

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('UPDATE variables SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('kind = ?');
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['renamed', 'let', 'var-uuid-1']);

      expect(result).toBeInstanceOf(Variable);
      expect(result.name).toBe('renamed');
    });

    it('updates only the type field when only type is provided', async () => {
      const updatedRow = makeRow({ type: 'number' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      await repo.update('var-uuid-1', { type: 'number' });

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('type = ?');
      expect(sql).not.toContain('name = ?');
      expect(params).toEqual(['number', 'var-uuid-1']);
    });

    it('updates only the initializer field when only initializer is provided', async () => {
      const updatedRow = makeRow({ initializer: '42' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      await repo.update('var-uuid-1', { initializer: '42' });

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('initializer = ?');
      expect(params).toEqual(['42', 'var-uuid-1']);
    });

    it('returns existing entity when no fields are provided and entity exists', async () => {
      const existingRow = makeRow();
      // retrieveById is called internally when no fields to update
      vi.mocked(adapter.query).mockResolvedValueOnce([existingRow]);

      const result = await repo.update('var-uuid-1', {});

      expect(result).toBeInstanceOf(Variable);
      expect(result.id).toBe('var-uuid-1');
    });

    it('throws RepositoryError when no fields provided and entity does not exist', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('nonexistent', {})).rejects.toThrow(RepositoryError);
    });

    it('throws RepositoryError when UPDATE returns no rows', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('nonexistent', { name: 'x' })).rejects.toThrow(RepositoryError);
    });
  });

  // ---------- retrieveById ----------

  describe('retrieveById', () => {
    it('returns a Variable entity when the row exists', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('var-uuid-1');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM variables WHERE id = ?');
      expect(params).toEqual(['var-uuid-1']);

      expect(result).toBeInstanceOf(Variable);
      expect(result?.id).toBe('var-uuid-1');
    });

    it('returns undefined when no row is found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // ---------- retrieveByModuleId ----------

  describe('retrieveByModuleId', () => {
    it('returns all variables for a given module ordered by name', async () => {
      const rows = [
        makeRow({ id: 'v1', name: 'alpha' }),
        makeRow({ id: 'v2', name: 'beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByModuleId('mod-uuid-1');

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id = ?');
      expect(sql).toContain('ORDER BY name');
      expect(params).toEqual(['mod-uuid-1']);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Variable);
      expect(result[0]!.name).toBe('alpha');
      expect(result[1]!.name).toBe('beta');
    });

    it('returns an empty array when no variables exist for the module', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveByModuleId('mod-empty');

      expect(result).toEqual([]);
    });
  });

  // ---------- retrieveByModuleIds ----------

  describe('retrieveByModuleIds', () => {
    it('returns variables for multiple module IDs', async () => {
      const rows = [
        makeRow({ id: 'v1', module_id: 'mod-1', name: 'a' }),
        makeRow({ id: 'v2', module_id: 'mod-2', name: 'b' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByModuleIds(['mod-1', 'mod-2']);

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id IN (?, ?)');
      expect(sql).toContain('ORDER BY name');
      expect(params).toEqual(['mod-1', 'mod-2']);

      expect(result).toHaveLength(2);
    });

    it('returns empty array immediately when given empty moduleIds', async () => {
      const result = await repo.retrieveByModuleIds([]);

      expect(result).toEqual([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });
  });

  // ---------- retrieve (all) ----------

  describe('retrieve', () => {
    it('returns all variables ordered by name', async () => {
      const rows = [
        makeRow({ id: 'v1', name: 'alpha' }),
        makeRow({ id: 'v2', name: 'beta' }),
        makeRow({ id: 'v3', name: 'gamma' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const result = await repo.retrieve();

      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM variables ORDER BY name');

      expect(result).toHaveLength(3);
      result.forEach((v) => expect(v).toBeInstanceOf(Variable));
    });

    it('returns an empty array when the table is empty', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieve();

      expect(result).toEqual([]);
    });
  });

  // ---------- delete ----------

  describe('delete', () => {
    it('executes a DELETE query with the given id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('var-uuid-1');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('DELETE FROM variables WHERE id = ?');
      expect(params).toEqual(['var-uuid-1']);
    });
  });

  // ---------- mapToEntity ----------

  describe('entity mapping', () => {
    it('maps null type to "unknown"', async () => {
      const row = makeRow({ type: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('var-uuid-1');

      expect(result?.type).toBe('unknown');
    });

    it('maps null initializer to undefined via mapToEntity', async () => {
      const row = makeRow({ initializer: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('var-uuid-1');

      // mapToEntity passes `undefined` to the Variable constructor, which defaults to ''
      expect(result?.initializer).toBe('');
    });

    it('maps created_at string to a Date instance', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('var-uuid-1');

      expect(result?.created_at).toBeInstanceOf(Date);
      expect(result?.created_at.toISOString()).toBe(TIMESTAMP);
    });

    it('preserves the kind field as-is', async () => {
      const row = makeRow({ kind: 'let' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('var-uuid-1');

      expect(result?.kind).toBe('let');
    });
  });

  // ---------- error propagation ----------

  describe('error propagation', () => {
    it('wraps adapter errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('connection lost'));

      await expect(repo.retrieveById('var-uuid-1')).rejects.toThrow(RepositoryError);
    });

    it('includes the operation name in the error message', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.retrieve()).rejects.toThrow(/retrieve all/);
    });
  });
});
