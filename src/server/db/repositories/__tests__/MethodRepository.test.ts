import { Method } from '../../../../shared/types/Method';
import { Parameter } from '../../../../shared/types/Parameter';
import { RepositoryError, EntityNotFoundError } from '../../errors/RepositoryError';
import { MethodRepository } from '../MethodRepository';

import type { IMethodCreateDTO, IMethodUpdateDTO } from '../MethodRepository';
import type { IDatabaseAdapter, QueryResult } from '../../adapter/IDatabaseAdapter';
import type { IMethodRow, IParameterRow } from '../../types/DatabaseResults';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
  };
}

function makeMethodDTO(overrides: Partial<IMethodCreateDTO> = {}): IMethodCreateDTO {
  return {
    id: 'method-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    parent_id: 'class-uuid-1',
    parent_type: 'class',
    name: 'doSomething',
    return_type: 'void',
    is_static: false,
    is_async: false,
    visibility: 'public',
    ...overrides,
  };
}

function makeMethodRow(overrides: Partial<IMethodRow> = {}): IMethodRow {
  return {
    id: 'method-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    parent_id: 'class-uuid-1',
    parent_type: 'class',
    name: 'doSomething',
    return_type: 'void',
    is_static: false,
    is_abstract: false,
    is_async: false,
    visibility: 'public',
    created_at: '2024-01-01T00:00:00.000Z',
  };
}

function makeParameterRow(overrides: Partial<IParameterRow> = {}): IParameterRow {
  return {
    id: 'param-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    method_id: 'method-uuid-1',
    name: 'arg1',
    type: 'string',
    is_optional: 0,
    is_rest: 0,
    default_value: null,
    created_at: '2024-01-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MethodRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: MethodRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new MethodRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('inserts a method row and returns a Method instance', async () => {
      const dto = makeMethodDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.create(dto);

      expect(result).toBeInstanceOf(Method);
      expect(result.id).toBe(dto.id);
      expect(result.name).toBe(dto.name);
      expect(result.return_type).toBe(dto.return_type);
      expect(result.is_static).toBe(dto.is_static);
      expect(result.is_async).toBe(dto.is_async);
      expect(result.visibility).toBe(dto.visibility);
      expect(result.package_id).toBe(dto.package_id);
      expect(result.module_id).toBe(dto.module_id);
      expect(result.parent_id).toBe(dto.parent_id);
    });

    it('passes has_explicit_return_type defaulting to false', async () => {
      const dto = makeMethodDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.create(dto);

      const callArgs = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql: string = callArgs[0];
      const params: unknown[] = callArgs[1];

      expect(sql).toContain('INSERT INTO methods');
      expect(sql).toContain('has_explicit_return_type');
      // Last parameter should be false (default for has_explicit_return_type)
      expect(params[params.length - 1]).toBe(false);
    });

    it('passes has_explicit_return_type when explicitly set to true', async () => {
      const dto = makeMethodDTO({ has_explicit_return_type: true });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.create(dto);

      const params: unknown[] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(params[params.length - 1]).toBe(true);
    });

    it('throws RepositoryError when the query fails', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB write failed'));

      await expect(repo.create(makeMethodDTO())).rejects.toThrow(RepositoryError);
    });

    it('returns a Method with an empty parameters map', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.create(makeMethodDTO());
      expect(result.parameters).toBeInstanceOf(Map);
      expect((result.parameters as Map<string, Parameter>).size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('does nothing when items array is empty', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('inserts multiple methods in a single batch statement', async () => {
      const dtos = [
        makeMethodDTO({ id: 'method-1', name: 'alpha' }),
        makeMethodDTO({ id: 'method-2', name: 'beta' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.createBatch(dtos);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sql).toContain('INSERT INTO methods');
      // Should have two sets of placeholders
      expect(sql).toContain('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    });

    it('falls back to individual inserts on duplicate key error', async () => {
      const dtos = [
        makeMethodDTO({ id: 'method-1', name: 'alpha' }),
        makeMethodDTO({ id: 'method-2', name: 'beta' }),
      ];

      // First batch call fails with duplicate
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Duplicate key'))
        // Individual inserts succeed
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.createBatch(dtos);

      // 1 batch + 2 individual
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('skips individual duplicates during fallback', async () => {
      const dtos = [
        makeMethodDTO({ id: 'method-1', name: 'alpha' }),
        makeMethodDTO({ id: 'method-2', name: 'beta' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE constraint'))
        // First individual insert is a duplicate
        .mockRejectedValueOnce(new Error('already exists'))
        // Second individual insert succeeds
        .mockResolvedValueOnce([]);

      await repo.createBatch(dtos);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('throws non-duplicate errors during batch insert', async () => {
      const dtos = [makeMethodDTO()];

      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection lost')
      );

      await expect(repo.createBatch(dtos)).rejects.toThrow('connection lost');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('updates a method and returns the updated Method instance', async () => {
      const updatedRow = makeMethodRow({ name: 'updatedName', return_type: 'string' });

      // First call: UPDATE query
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // Second call: retrieve to return updated entity
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedRow]);

      const updateDTO: IMethodUpdateDTO = { name: 'updatedName', return_type: 'string' };
      const result = await repo.update('method-uuid-1', updateDTO);

      expect(result).toBeInstanceOf(Method);
      expect(result.name).toBe('updatedName');
      expect(result.return_type).toBe('string');
    });

    it('builds SET clause only for provided fields', async () => {
      const updatedRow = makeMethodRow({ is_static: true });

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      await repo.update('method-uuid-1', { is_static: true });

      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sql).toContain('is_static = ?');
      // Should not contain fields not provided in the DTO
      expect(sql).not.toContain('name = ?');
      expect(sql).not.toContain('return_type = ?');
    });

    it('throws EntityNotFoundError when method not found after update', async () => {
      // UPDATE succeeds
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // retrieve returns no rows
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(repo.update('nonexistent-id', { name: 'foo' })).rejects.toThrow(
        EntityNotFoundError
      );
    });

    it('rethrows RepositoryError subclasses without wrapping', async () => {
      const entityError = new EntityNotFoundError('Method', 'bad-id', '[MethodRepository]');
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(entityError);

      await expect(repo.update('bad-id', { name: 'foo' })).rejects.toThrow(EntityNotFoundError);
    });

    it('wraps non-RepositoryError in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TypeError('unexpected null')
      );

      await expect(repo.update('method-uuid-1', { name: 'x' })).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('retrieves all methods when no filters are provided', async () => {
      const row1 = makeMethodRow({ id: 'method-1', name: 'alpha' });
      const row2 = makeMethodRow({ id: 'method-2', name: 'beta' });
      console.log('DEBUG row1:', JSON.stringify(row1));
      console.log('DEBUG row2:', JSON.stringify(row2));
      const rows = [row1, row2];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieve();
      console.log('DEBUG result[0].id:', result[0]?.id);
      console.log('DEBUG result length:', result.length);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Method);
      expect(result[0]!.id).toBe('method-1');
      expect(result[1]).toBeInstanceOf(Method);
      expect(result[1]!.id).toBe('method-2');
    });

    it('filters by id when id is provided', async () => {
      const row = makeMethodRow({ id: 'method-1' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      await repo.retrieve('method-1');

      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const params: unknown[] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(sql).toContain('m.id = ?');
      expect(params).toContain('method-1');
    });

    it('filters by module_id when module_id is provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve(undefined, 'mod-uuid-1');

      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const params: unknown[] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(sql).toContain('m.module_id = ?');
      expect(params).toContain('mod-uuid-1');
    });

    it('combines id and module_id conditions with AND', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve('method-1', 'mod-uuid-1');

      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sql).toContain('m.id = ?');
      expect(sql).toContain('AND');
      expect(sql).toContain('m.module_id = ?');
    });

    it('returns empty array when no results', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieve('nonexistent');
      expect(result).toEqual([]);
    });

    it('maps row data to Method instances correctly', async () => {
      const row = makeMethodRow({
        is_static: true,
        is_async: true,
        visibility: 'private',
        return_type: 'Promise<string>',
      });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const [method] = await repo.retrieve('method-uuid-1');

      expect(method!.is_static).toBe(true);
      expect(method!.is_async).toBe(true);
      expect(method!.visibility).toBe('private');
      expect(method!.return_type).toBe('Promise<string>');
    });

    it('throws RepositoryError on query failure', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('query timeout')
      );

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('returns the Method when found', async () => {
      const row = makeMethodRow({ id: 'method-1' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('method-1');

      expect(result).toBeInstanceOf(Method);
      expect(result!.id).toBe('method-1');
    });

    it('returns undefined when not found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('returns methods for the given module', async () => {
      const rows = [
        makeMethodRow({ id: 'method-1', module_id: 'mod-1' }),
        makeMethodRow({ id: 'method-2', module_id: 'mod-1' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByModuleId('mod-1');

      expect(result).toHaveLength(2);
      result.forEach((m) => expect(m).toBeInstanceOf(Method));
    });

    it('returns empty array when module has no methods', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveByModuleId('empty-mod');
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('deletes parameters first, then the method', async () => {
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // DELETE parameters
        .mockResolvedValueOnce([]); // DELETE method

      await repo.delete('method-uuid-1');

      expect(adapter.query).toHaveBeenCalledTimes(2);

      const firstSql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const secondSql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[1][0];

      expect(firstSql).toContain('DELETE FROM parameters');
      expect(firstSql).toContain('method_id = ?');
      expect(secondSql).toContain('DELETE FROM methods');
      expect(secondSql).toContain('id = ?');
    });

    it('passes the correct id to both delete queries', async () => {
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.delete('target-id');

      const firstParams = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const secondParams = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[1][1];

      expect(firstParams).toEqual(['target-id']);
      expect(secondParams).toEqual(['target-id']);
    });

    it('throws RepositoryError when delete fails', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('FK constraint')
      );

      await expect(repo.delete('method-uuid-1')).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByParent
  // -----------------------------------------------------------------------
  describe('retrieveByParent', () => {
    it('returns an empty map when no methods exist for the parent', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveByParent('class-1', 'class');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      // Should NOT call the parameter query when no methods are found
      expect(adapter.query).toHaveBeenCalledTimes(1);
    });

    it('queries with the correct parent_id and parent_type', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieveByParent('iface-1', 'interface');

      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const params: unknown[] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][1];

      expect(sql).toContain('m.parent_id = ?');
      expect(sql).toContain('m.parent_type = ?');
      expect(params).toEqual(['iface-1', 'interface']);
    });

    it('returns methods with their parameters', async () => {
      const methodRows: IMethodRow[] = [
        makeMethodRow({ id: 'method-1', name: 'foo' }),
        makeMethodRow({ id: 'method-2', name: 'bar' }),
      ];
      const paramRows: IParameterRow[] = [
        makeParameterRow({ id: 'param-1', method_id: 'method-1', name: 'x', type: 'number' }),
        makeParameterRow({ id: 'param-2', method_id: 'method-1', name: 'y', type: 'string' }),
        makeParameterRow({ id: 'param-3', method_id: 'method-2', name: 'z', type: 'boolean' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce(paramRows);

      const result = await repo.retrieveByParent('class-uuid-1', 'class');

      expect(result.size).toBe(2);

      const method1 = result.get('method-1')!;
      expect(method1).toBeInstanceOf(Method);
      expect(method1.name).toBe('foo');
      const params1 = method1.parameters as Map<string, Parameter>;
      expect(params1.size).toBe(2);
      expect(params1.get('param-1')!.name).toBe('x');
      expect(params1.get('param-2')!.name).toBe('y');

      const method2 = result.get('method-2')!;
      const params2 = method2.parameters as Map<string, Parameter>;
      expect(params2.size).toBe(1);
      expect(params2.get('param-3')!.name).toBe('z');
    });

    it('handles methods with no parameters', async () => {
      const methodRows: IMethodRow[] = [makeMethodRow({ id: 'method-1' })];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce([]); // no parameters

      const result = await repo.retrieveByParent('class-uuid-1', 'class');

      const method = result.get('method-1')!;
      const params = method.parameters as Map<string, Parameter>;
      expect(params.size).toBe(0);
    });

    it('constructs Parameter instances with correct properties', async () => {
      const methodRows: IMethodRow[] = [makeMethodRow({ id: 'method-1' })];
      const paramRows: IParameterRow[] = [
        makeParameterRow({
          id: 'param-1',
          method_id: 'method-1',
          name: 'opts',
          type: 'Options',
          is_optional: 1,
          is_rest: 0,
          default_value: '{}',
        }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce(paramRows);

      const result = await repo.retrieveByParent('class-uuid-1', 'class');
      const method = result.get('method-1')!;
      const param = (method.parameters as Map<string, Parameter>).get('param-1')!;

      expect(param).toBeInstanceOf(Parameter);
      expect(param.name).toBe('opts');
      expect(param.type).toBe('Options');
      expect(param.is_optional).toBe(true);
      expect(param.is_rest).toBe(false);
      expect(param.default_value).toBe('{}');
    });

    it('handles rest parameter correctly', async () => {
      const methodRows: IMethodRow[] = [makeMethodRow({ id: 'method-1' })];
      const paramRows: IParameterRow[] = [
        makeParameterRow({
          id: 'param-1',
          method_id: 'method-1',
          name: 'args',
          type: 'string[]',
          is_optional: 0,
          is_rest: 1,
          default_value: null,
        }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce(paramRows);

      const result = await repo.retrieveByParent('class-uuid-1', 'class');
      const param = (result.get('method-1')!.parameters as Map<string, Parameter>).get('param-1')!;

      expect(param.is_rest).toBe(true);
      expect(param.default_value).toBeUndefined();
    });

    it('throws RepositoryError on query failure', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused')
      );

      await expect(repo.retrieveByParent('class-1', 'class')).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByParentIds
  // -----------------------------------------------------------------------
  describe('retrieveByParentIds', () => {
    it('returns an empty map when parentIds is empty', async () => {
      const result = await repo.retrieveByParentIds([], 'class');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('initializes empty maps for every requested parent', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // no methods

      const result = await repo.retrieveByParentIds(['p1', 'p2', 'p3'], 'interface');

      expect(result.size).toBe(3);
      expect(result.get('p1')!.size).toBe(0);
      expect(result.get('p2')!.size).toBe(0);
      expect(result.get('p3')!.size).toBe(0);
    });

    it('queries with IN clause for parent ids and parent_type', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieveByParentIds(['p1', 'p2'], 'class');

      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const params: unknown[] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0][1];

      expect(sql).toContain('IN (?, ?)');
      expect(sql).toContain('m.parent_type = ?');
      expect(params).toEqual(['p1', 'p2', 'class']);
    });

    it('groups methods by parent_id with their parameters', async () => {
      const methodRows: IMethodRow[] = [
        makeMethodRow({ id: 'method-1', parent_id: 'p1', name: 'alpha' }),
        makeMethodRow({ id: 'method-2', parent_id: 'p1', name: 'beta' }),
        makeMethodRow({ id: 'method-3', parent_id: 'p2', name: 'gamma' }),
      ];
      const paramRows: IParameterRow[] = [
        makeParameterRow({ id: 'param-1', method_id: 'method-1', name: 'x' }),
        makeParameterRow({ id: 'param-2', method_id: 'method-3', name: 'y' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce(paramRows);

      const result = await repo.retrieveByParentIds(['p1', 'p2'], 'class');

      expect(result.get('p1')!.size).toBe(2);
      expect(result.get('p2')!.size).toBe(1);

      const method1 = result.get('p1')!.get('method-1')!;
      expect(method1.name).toBe('alpha');
      expect((method1.parameters as Map<string, Parameter>).size).toBe(1);

      const method3 = result.get('p2')!.get('method-3')!;
      expect(method3.name).toBe('gamma');
      expect((method3.parameters as Map<string, Parameter>).size).toBe(1);
    });

    it('fetches parameters for retrieved methods', async () => {
      const methodRows: IMethodRow[] = [
        makeMethodRow({ id: 'method-1', parent_id: 'p1' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce([]); // parameters query

      await repo.retrieveByParentIds(['p1'], 'class');

      // Should have 2 queries: methods + parameters
      expect(adapter.query).toHaveBeenCalledTimes(2);
      const paramSql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(paramSql).toContain('SELECT p.* FROM parameters p');
      expect(paramSql).toContain('p.method_id IN');
    });

    it('does not query for parameters when no methods found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieveByParentIds(['p1'], 'class');

      // Only the method query, no parameter query
      expect(adapter.query).toHaveBeenCalledTimes(1);
    });

    it('throws RepositoryError on query failure', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('database locked')
      );

      await expect(repo.retrieveByParentIds(['p1'], 'class')).rejects.toThrow(RepositoryError);
    });

    it('handles methods with no matching parent in result map gracefully', async () => {
      // Method has a parent_id that was not in the requested list
      // (shouldn't happen in practice, but ensures no crash)
      const methodRows: IMethodRow[] = [
        makeMethodRow({ id: 'method-1', parent_id: 'p-unknown' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(methodRows)
        .mockResolvedValueOnce([]);

      const result = await repo.retrieveByParentIds(['p1'], 'class');

      // p1 should have empty map; p-unknown is not in result at all
      expect(result.get('p1')!.size).toBe(0);
      expect(result.has('p-unknown')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Constructor / initialization
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('sets the table name to "methods"', () => {
      // Access the protected tableName through a query that embeds it
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      // Trigger an update which uses this.tableName
      repo.update('x', { name: 'y' }).catch(() => {
        // We expect this might fail; we just need the query to fire
      });

      // The UPDATE query should reference the "methods" table
      const sql: string = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '';
      expect(sql).toContain('methods');
    });
  });
});
