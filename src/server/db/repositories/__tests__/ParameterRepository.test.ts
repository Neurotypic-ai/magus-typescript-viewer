// @vitest-environment node
import { vi } from 'vitest';

import { Parameter } from '../../../../shared/types/Parameter';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../../errors/RepositoryError';
import { ParameterRepository } from '../ParameterRepository';

import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';
import type { IParameterRow } from '../../types/DatabaseResults';
import type { IParameterCreateDTO } from '../ParameterRepository';

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

function makeDTO(overrides: Partial<IParameterCreateDTO> = {}): IParameterCreateDTO {
  return {
    id: 'param-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    method_id: 'meth-1',
    name: 'foo',
    type: 'string',
    is_optional: false,
    is_rest: false,
    default_value: undefined,
    ...overrides,
  };
}

function makeRow(overrides: Partial<IParameterRow> = {}): IParameterRow {
  return {
    id: 'param-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    method_id: 'meth-1',
    name: 'foo',
    type: 'string',
    is_optional: 0,
    is_rest: 0,
    default_value: null,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParameterRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: ParameterRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new ParameterRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('inserts a row and returns a Parameter instance', async () => {
      const dto = makeDTO();
      const result = await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledTimes(1);

      // Verify the SQL contains the INSERT statement
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO parameters');
      expect(params).toContain(dto.id);
      expect(params).toContain(dto.package_id);
      expect(params).toContain(dto.module_id);
      expect(params).toContain(dto.method_id);
      expect(params).toContain(dto.name);
      expect(params).toContain(dto.type);

      // Boolean fields are stored as 0/1
      expect(params).toContain(0); // is_optional = false => 0
      // default_value undefined => ''
      expect(params).toContain('');

      // Return value should be a Parameter
      expect(result).toBeInstanceOf(Parameter);
      expect(result.id).toBe(dto.id);
      expect(result.package_id).toBe(dto.package_id);
      expect(result.module_id).toBe(dto.module_id);
      expect(result.method_id).toBe(dto.method_id);
      expect(result.name).toBe(dto.name);
      expect(result.type).toBe(dto.type);
      expect(result.is_optional).toBe(false);
      expect(result.is_rest).toBe(false);
      expect(result.default_value).toBeUndefined();
    });

    it('stores boolean true fields as 1', async () => {
      const dto = makeDTO({ is_optional: true, is_rest: true });
      await repo.create(dto);

      const [, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      // is_optional = true => 1, is_rest = true => 1
      expect(params[6]).toBe(1);
      expect(params[7]).toBe(1);
    });

    it('stores a provided default_value', async () => {
      const dto = makeDTO({ default_value: '"hello"' });
      const result = await repo.create(dto);

      const [, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(params[8]).toBe('"hello"');
      expect(result.default_value).toBe('"hello"');
    });

    it('wraps adapter errors in RepositoryError', async () => {
      adapter = createMockAdapter({
        query: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      });
      repo = new ParameterRepository(adapter);

      await expect(repo.create(makeDTO())).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('builds SET clauses for provided fields and returns updated Parameter', async () => {
      const updatedRow = makeRow({ name: 'bar', type: 'number' });

      // First call is the UPDATE, second call is the SELECT for retrieve
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([updatedRow]); // SELECT (via retrieve)

      const result = await repo.update('param-1', { name: 'bar', type: 'number' });

      expect(adapter.query).toHaveBeenCalledTimes(2);

      const [updateSql, updateParams] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE parameters SET');
      expect(updateSql).toContain('name = ?');
      expect(updateSql).toContain('type = ?');
      expect(updateParams).toContain('bar');
      expect(updateParams).toContain('number');
      expect(updateParams[updateParams.length - 1]).toBe('param-1'); // WHERE id = ?

      expect(result).toBeInstanceOf(Parameter);
      expect(result.name).toBe('bar');
      expect(result.type).toBe('number');
    });

    it('converts boolean fields to 0/1 in SET clause', async () => {
      const updatedRow = makeRow({ is_optional: 1, is_rest: 1 });

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      await repo.update('param-1', { is_optional: true, is_rest: true });

      const [, updateParams] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(updateParams).toContain(1); // is_optional = true => 1
    });

    it('throws NoFieldsToUpdateError when dto is empty', async () => {
      await expect(repo.update('param-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('throws EntityNotFoundError when updated row cannot be retrieved', async () => {
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // UPDATE succeeds
        .mockResolvedValueOnce([]); // SELECT returns nothing

      await expect(repo.update('param-1', { name: 'bar' })).rejects.toThrow(EntityNotFoundError);
    });

    it('re-throws RepositoryError subclasses as-is', async () => {
      // NoFieldsToUpdateError is a RepositoryError; it should not be wrapped again
      await expect(repo.update('param-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('wraps non-RepositoryError errors in RepositoryError', async () => {
      adapter = createMockAdapter({
        query: vi.fn().mockRejectedValue(new TypeError('something unexpected')),
      });
      repo = new ParameterRepository(adapter);

      await expect(repo.update('param-1', { name: 'bar' })).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('returns all parameters when no filters provided', async () => {
      const rows: IParameterRow[] = [makeRow(), makeRow({ id: 'param-2', name: 'bar' })];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.retrieve();

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toBe('SELECT * FROM parameters');
      expect(params).toEqual([]);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Parameter);
      expect(result[1]).toBeInstanceOf(Parameter);
    });

    it('filters by id when provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      await repo.retrieve('param-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE');
      expect(sql).toContain('id = ?');
      expect(params).toContain('param-1');
    });

    it('filters by module_id when provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      await repo.retrieve(undefined, 'mod-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE');
      expect(sql).toContain('module_id = ?');
      expect(params).toContain('mod-1');
    });

    it('filters by both id and module_id', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      await repo.retrieve('param-1', 'mod-1');

      const [sql] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('id = ?');
      expect(sql).toContain('AND');
      expect(sql).toContain('module_id = ?');
    });

    it('maps is_optional and is_rest from numeric to boolean', async () => {
      const row = makeRow({ is_optional: 1, is_rest: 1 });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      const result = await repo.retrieve();

      const param = result[0];
      expect(param).toBeDefined();
      expect(param?.is_optional).toBe(true);
      expect(param?.is_rest).toBe(true);
    });

    it('maps default_value null to undefined', async () => {
      const row = makeRow({ default_value: null });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      const result = await repo.retrieve();

      expect(result[0]?.default_value).toBeUndefined();
    });

    it('maps default_value string to string', async () => {
      const row = makeRow({ default_value: '"hello"' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      const result = await repo.retrieve();

      expect(result[0]?.default_value).toBe('"hello"');
    });

    it('wraps adapter errors in RepositoryError', async () => {
      adapter = createMockAdapter({
        query: vi.fn().mockRejectedValue(new Error('query failed')),
      });
      repo = new ParameterRepository(adapter);

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('returns the first matching Parameter', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      const result = await repo.retrieveById('param-1');

      expect(result).toBeInstanceOf(Parameter);
      expect(result?.id).toBe('param-1');
    });

    it('returns undefined when no match found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('delegates to retrieve with module_id', async () => {
      const rows = [makeRow(), makeRow({ id: 'param-2' })];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.retrieveByModuleId('mod-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('module_id = ?');
      expect(params).toContain('mod-1');
      expect(result).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('executes DELETE query with the given id', async () => {
      await repo.delete('param-1');

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toBe('DELETE FROM parameters WHERE id = ?');
      expect(params).toEqual(['param-1']);
    });

    it('wraps adapter errors in RepositoryError', async () => {
      adapter = createMockAdapter({
        query: vi.fn().mockRejectedValue(new Error('delete failed')),
      });
      repo = new ParameterRepository(adapter);

      await expect(repo.delete('param-1')).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // findByMethodId
  // -----------------------------------------------------------------------
  describe('findByMethodId', () => {
    it('returns parameters ordered by id for a given method', async () => {
      const rows = [
        makeRow({ id: 'param-1', method_id: 'meth-1', name: 'a' }),
        makeRow({ id: 'param-2', method_id: 'meth-1', name: 'b' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByMethodId('meth-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE method_id = ?');
      expect(sql).toContain('ORDER BY id ASC');
      expect(params).toEqual(['meth-1']);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Parameter);
      expect(result[0]?.name).toBe('a');
      expect(result[1]?.name).toBe('b');
    });

    it('returns empty array when no parameters match', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByMethodId('nonexistent');

      expect(result).toEqual([]);
    });

    it('maps default_value correctly', async () => {
      const rows = [
        makeRow({ default_value: '42' }),
        makeRow({ id: 'param-2', default_value: null }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByMethodId('meth-1');

      expect(result[0]?.default_value).toBe('42');
      expect(result[1]?.default_value).toBeUndefined();
    });

    it('wraps adapter errors in RepositoryError', async () => {
      adapter = createMockAdapter({
        query: vi.fn().mockRejectedValue(new Error('method lookup failed')),
      });
      repo = new ParameterRepository(adapter);

      await expect(repo.findByMethodId('meth-1')).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('does nothing when given an empty array', async () => {
      await repo.createBatch([]);

      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('inserts multiple items in a single query', async () => {
      const items = [
        makeDTO({ id: 'p1', name: 'a' }),
        makeDTO({ id: 'p2', name: 'b' }),
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO parameters');
      expect(sql).toContain('VALUES');
      // Should have two sets of placeholders (10 columns each)
      expect(params).toHaveLength(20);
    });

    it('falls back to individual inserts on duplicate key error', async () => {
      const items = [
        makeDTO({ id: 'p1', name: 'a' }),
        makeDTO({ id: 'p2', name: 'b' }),
      ];

      // First call (batch) rejects with duplicate error; individual calls succeed
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Duplicate key'))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual inserts
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('skips individual duplicates during fallback', async () => {
      const items = [
        makeDTO({ id: 'p1', name: 'a' }),
        makeDTO({ id: 'p2', name: 'b' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE constraint'))
        .mockRejectedValueOnce(new Error('UNIQUE constraint')) // p1 is a duplicate
        .mockResolvedValueOnce([]); // p2 succeeds

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('rethrows non-duplicate errors from batch insert', async () => {
      const items = [makeDTO({ id: 'p1' })];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('Disk full');
    });

    it('rethrows non-duplicate errors during individual fallback', async () => {
      const items = [makeDTO({ id: 'p1' })];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Duplicate key')) // batch fails
        .mockRejectedValueOnce(new Error('Disk full'));    // individual fails with non-duplicate

      await expect(repo.createBatch(items)).rejects.toThrow('Disk full');
    });
  });
});
