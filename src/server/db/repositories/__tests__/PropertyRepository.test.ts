// @vitest-environment node
import { Property } from '../../../../shared/types/Property';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../../errors/RepositoryError';
import { PropertyRepository } from '../PropertyRepository';

import type { IDatabaseAdapter, QueryResult } from '../../adapter/IDatabaseAdapter';
import type { IPropertyCreateDTO } from '../PropertyRepository';
import type { IPropertyRow } from '../../types/DatabaseResults';

/**
 * Creates a mock IDatabaseAdapter with vi.fn() stubs for all methods.
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
 * Creates a valid IPropertyCreateDTO for testing.
 */
function createPropertyDTO(overrides: Partial<IPropertyCreateDTO> = {}): IPropertyCreateDTO {
  return {
    id: 'prop-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    parent_id: 'class-uuid-1',
    parent_type: 'class',
    name: 'myProperty',
    type: 'string',
    is_static: false,
    is_readonly: false,
    visibility: 'public',
    ...overrides,
  };
}

/**
 * Creates a mock IPropertyRow as it would come back from the database.
 */
function createPropertyRow(overrides: Partial<IPropertyRow> = {}): IPropertyRow {
  return {
    id: 'prop-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    parent_id: 'class-uuid-1',
    parent_type: 'class',
    name: 'myProperty',
    type: 'string',
    is_static: false,
    is_readonly: false,
    visibility: 'public',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PropertyRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: PropertyRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new PropertyRepository(adapter);
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should insert a property and return a Property instance', async () => {
      const dto = createPropertyDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.create(dto);

      expect(result).toBeInstanceOf(Property);
      expect(result.id).toBe(dto.id);
      expect(result.package_id).toBe(dto.package_id);
      expect(result.module_id).toBe(dto.module_id);
      expect(result.parent_id).toBe(dto.parent_id);
      expect(result.name).toBe(dto.name);
      expect(result.type).toBe(dto.type);
      expect(result.is_static).toBe(dto.is_static);
      expect(result.is_readonly).toBe(dto.is_readonly);
      expect(result.visibility).toBe(dto.visibility);
    });

    it('should execute an INSERT query with the correct parameters', async () => {
      const dto = createPropertyDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO properties'),
        [
          dto.id,
          dto.package_id,
          dto.module_id,
          dto.parent_id,
          dto.parent_type,
          dto.name,
          dto.type,
          dto.is_static,
          dto.is_readonly,
          dto.visibility,
        ]
      );
    });

    it('should set created_at to a Date on the returned Property', async () => {
      const dto = createPropertyDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.create(dto);

      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('should throw a RepositoryError when the query fails', async () => {
      const dto = createPropertyDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
    });

    it('should include "create" context in the thrown RepositoryError', async () => {
      const dto = createPropertyDTO();
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'));

      await expect(repo.create(dto)).rejects.toThrow(/create/i);
    });
  });

  // ---------------------------------------------------------------------------
  // createBatch
  // ---------------------------------------------------------------------------
  describe('createBatch', () => {
    it('should do nothing for an empty array', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should insert all items in a single query for small batches', async () => {
      const items = [
        createPropertyDTO({ id: 'prop-1', name: 'alpha' }),
        createPropertyDTO({ id: 'prop-2', name: 'beta' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('INSERT INTO properties');
      // Should have 2 value groups (10 placeholders each)
      expect(sql).toContain('?, ?, ?, ?, ?, ?, ?, ?, ?, ?');
    });

    it('should fall back to individual inserts on duplicate key errors', async () => {
      const items = [
        createPropertyDTO({ id: 'prop-1', name: 'alpha' }),
        createPropertyDTO({ id: 'prop-2', name: 'beta' }),
      ];

      // First bulk insert fails with a duplicate error
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Duplicate key constraint: UNIQUE violation'))
        .mockResolvedValueOnce([]) // individual insert #1 succeeds
        .mockResolvedValueOnce([]); // individual insert #2 succeeds

      await repo.createBatch(items);

      // 1 bulk + 2 individual = 3 calls
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should silently skip individual duplicate inserts during fallback', async () => {
      const items = [
        createPropertyDTO({ id: 'prop-1', name: 'alpha' }),
        createPropertyDTO({ id: 'prop-2', name: 'beta' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE violation'))
        .mockRejectedValueOnce(new Error('Duplicate entry')) // first item is a dup
        .mockResolvedValueOnce([]); // second item succeeds

      // Should not throw
      await repo.createBatch(items);
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should rethrow non-duplicate errors from the bulk insert', async () => {
      const items = [createPropertyDTO({ id: 'prop-1' })];
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('Disk full');
    });

    it('should rethrow non-duplicate errors during individual fallback inserts', async () => {
      const items = [
        createPropertyDTO({ id: 'prop-1' }),
        createPropertyDTO({ id: 'prop-2' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE violation')) // triggers fallback
        .mockRejectedValueOnce(new Error('Disk full')); // non-duplicate error in fallback

      await expect(repo.createBatch(items)).rejects.toThrow('Disk full');
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve
  // ---------------------------------------------------------------------------
  describe('retrieve', () => {
    it('should return all properties when no filters are provided', async () => {
      const rows = [
        createPropertyRow({ id: 'prop-1', name: 'alpha' }),
        createPropertyRow({ id: 'prop-2', name: 'beta' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieve();

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Property);
      expect(result[0]!.id).toBe('prop-1');
      expect(result[1]).toBeInstanceOf(Property);
      expect(result[1]!.id).toBe('prop-2');
    });

    it('should filter by id when provided', async () => {
      const rows = [createPropertyRow({ id: 'prop-1' })];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      await repo.retrieve('prop-1');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('id = ?');
      expect(call[1]).toEqual(['prop-1']);
    });

    it('should filter by module_id when provided', async () => {
      const rows: IPropertyRow[] = [];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      await repo.retrieve(undefined, 'mod-1');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('module_id = ?');
      expect(call[1]).toEqual(['mod-1']);
    });

    it('should filter by both id and module_id when both are provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve('prop-1', 'mod-1');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('id = ?');
      expect(sql).toContain('AND');
      expect(sql).toContain('module_id = ?');
      expect(call[1]).toEqual(['prop-1', 'mod-1']);
    });

    it('should return an empty array when no results are found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieve('nonexistent');
      expect(result).toEqual([]);
    });

    it('should correctly map row fields to Property constructor parameters', async () => {
      const row = createPropertyRow({
        id: 'p1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        parent_id: 'cls-1',
        name: 'count',
        type: 'number',
        is_static: true,
        is_readonly: true,
        visibility: 'private',
        created_at: '2025-06-15T12:00:00.000Z',
      });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieve('p1');

      expect(result).toHaveLength(1);
      const prop = result[0]!;
      expect(prop.id).toBe('p1');
      expect(prop.package_id).toBe('pkg-1');
      expect(prop.module_id).toBe('mod-1');
      expect(prop.parent_id).toBe('cls-1');
      expect(prop.name).toBe('count');
      expect(prop.type).toBe('number');
      expect(prop.is_static).toBe(true);
      expect(prop.is_readonly).toBe(true);
      expect(prop.visibility).toBe('private');
      expect(prop.created_at).toBeInstanceOf(Date);
    });

    it('should throw a RepositoryError when the query fails', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveById
  // ---------------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should return a Property when found', async () => {
      const row = createPropertyRow({ id: 'prop-1' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('prop-1');

      expect(result).toBeInstanceOf(Property);
      expect(result!.id).toBe('prop-1');
    });

    it('should return undefined when no property is found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByModuleId
  // ---------------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should return properties filtered by module_id', async () => {
      const rows = [
        createPropertyRow({ id: 'prop-1', module_id: 'mod-1' }),
        createPropertyRow({ id: 'prop-2', module_id: 'mod-1' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByModuleId('mod-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Property);
    });

    it('should return an empty array when no properties match', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveByModuleId('mod-nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should update fields and return the updated Property', async () => {
      const updatedRow = createPropertyRow({ id: 'prop-1', name: 'updatedName', type: 'number' });

      // First call: UPDATE query returns []
      // Second call: retrieve query returns the updated row
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('prop-1', { name: 'updatedName', type: 'number' });

      expect(result).toBeInstanceOf(Property);
      expect(result.name).toBe('updatedName');
      expect(result.type).toBe('number');
    });

    it('should build the correct UPDATE query for a single field', async () => {
      const updatedRow = createPropertyRow({ id: 'prop-1', name: 'renamed' });
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      await repo.update('prop-1', { name: 'renamed' });

      const firstCall = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstCall[0] as string;
      expect(sql).toContain('UPDATE properties SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('WHERE id = ?');
    });

    it('should build the correct UPDATE query for multiple fields', async () => {
      const updatedRow = createPropertyRow({ id: 'prop-1' });
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      await repo.update('prop-1', { name: 'newName', is_static: true, visibility: 'private' });

      const firstCall = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstCall[0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('is_static = ?');
      expect(sql).toContain('visibility = ?');
    });

    it('should throw NoFieldsToUpdateError when all fields are undefined', async () => {
      await expect(repo.update('prop-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('should throw EntityNotFoundError when the property does not exist after update', async () => {
      // UPDATE succeeds but retrieve returns empty
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await expect(repo.update('nonexistent', { name: 'x' })).rejects.toThrow(EntityNotFoundError);
    });

    it('should rethrow RepositoryError subclasses without wrapping', async () => {
      // NoFieldsToUpdateError should pass through directly
      await expect(repo.update('prop-1', {})).rejects.toThrow(NoFieldsToUpdateError);

      try {
        await repo.update('prop-1', {});
      } catch (error) {
        // Should be a NoFieldsToUpdateError, not a generic RepositoryError wrapper
        expect((error as Error).name).toBe('NoFieldsToUpdateError');
      }
    });

    it('should wrap non-RepositoryError failures as RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('unexpected'));

      await expect(repo.update('prop-1', { name: 'x' })).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('should execute a DELETE query with the correct id', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.delete('prop-1');

      expect(adapter.query).toHaveBeenCalledWith(
        'DELETE FROM properties WHERE id = ?',
        ['prop-1']
      );
    });

    it('should not throw when deleting a non-existent id', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(repo.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('should throw a RepositoryError when the query fails', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('permission denied'));

      await expect(repo.delete('prop-1')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByParent
  // ---------------------------------------------------------------------------
  describe('retrieveByParent', () => {
    it('should return a Map of properties keyed by property id', async () => {
      const rows = [
        createPropertyRow({ id: 'prop-1', parent_id: 'cls-1', parent_type: 'class', name: 'alpha' }),
        createPropertyRow({ id: 'prop-2', parent_id: 'cls-1', parent_type: 'class', name: 'beta' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByParent('cls-1', 'class');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('prop-1')).toBeInstanceOf(Property);
      expect(result.get('prop-1')!.name).toBe('alpha');
      expect(result.get('prop-2')).toBeInstanceOf(Property);
      expect(result.get('prop-2')!.name).toBe('beta');
    });

    it('should query with the correct parent_id and parent_type parameters', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieveByParent('iface-1', 'interface');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('parent_id = ?');
      expect(sql).toContain('parent_type = ?');
      expect(call[1]).toEqual(['iface-1', 'interface']);
    });

    it('should return an empty Map when no properties exist for the parent', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveByParent('empty-parent', 'class');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should throw a RepositoryError when the query fails', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));

      await expect(repo.retrieveByParent('cls-1', 'class')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByParentIds
  // ---------------------------------------------------------------------------
  describe('retrieveByParentIds', () => {
    it('should return an empty Map for an empty parentIds array', async () => {
      const result = await repo.retrieveByParentIds([], 'class');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should return a Map keyed by parent_id with nested Maps of properties', async () => {
      const rows = [
        createPropertyRow({ id: 'p1', parent_id: 'cls-1', parent_type: 'class', name: 'x' }),
        createPropertyRow({ id: 'p2', parent_id: 'cls-1', parent_type: 'class', name: 'y' }),
        createPropertyRow({ id: 'p3', parent_id: 'cls-2', parent_type: 'class', name: 'z' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByParentIds(['cls-1', 'cls-2'], 'class');

      expect(result.size).toBe(2);

      const cls1Props = result.get('cls-1')!;
      expect(cls1Props.size).toBe(2);
      expect(cls1Props.get('p1')!.name).toBe('x');
      expect(cls1Props.get('p2')!.name).toBe('y');

      const cls2Props = result.get('cls-2')!;
      expect(cls2Props.size).toBe(1);
      expect(cls2Props.get('p3')!.name).toBe('z');
    });

    it('should initialise empty Maps for parent IDs that have no properties', async () => {
      const rows = [
        createPropertyRow({ id: 'p1', parent_id: 'cls-1', parent_type: 'class' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByParentIds(['cls-1', 'cls-2'], 'class');

      expect(result.get('cls-1')!.size).toBe(1);
      expect(result.get('cls-2')!.size).toBe(0);
    });

    it('should build the correct IN query with placeholders', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieveByParentIds(['cls-1', 'cls-2', 'cls-3'], 'interface');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('parent_id IN (?, ?, ?)');
      expect(sql).toContain('parent_type = ?');
      expect(call[1]).toEqual(['cls-1', 'cls-2', 'cls-3', 'interface']);
    });

    it('should throw a RepositoryError when the query fails', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'));

      await expect(repo.retrieveByParentIds(['cls-1'], 'class')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('should set the correct table name', () => {
      // We verify this indirectly through query calls
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      repo.delete('some-id');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('properties');
    });
  });
});
