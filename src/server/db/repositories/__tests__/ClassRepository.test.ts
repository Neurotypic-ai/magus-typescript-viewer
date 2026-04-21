/* eslint-disable @typescript-eslint/unbound-method -- adapter.query is a vi.fn() mock */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Class } from '../../../../shared/types/Class';
import { createMockDatabaseAdapter } from '../../__tests__/mockDatabaseAdapter';
import { RepositoryError } from '../../errors/RepositoryError';
import { ClassRepository } from '../ClassRepository';

import type { IClassCreateDTO } from '../../../../shared/types/dto/ClassDTO';
import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';

/** Timestamp used across all mock rows so assertions are deterministic. */
const FIXED_DATE = '2025-01-15T12:00:00.000Z';

/**
 * Factory for a mock IClassOrInterfaceRow coming back from the adapter.
 */
function mockClassRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'class-id-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'TestClass',
    created_at: FIXED_DATE,
    extends_id: undefined,
    ...overrides,
  };
}

/**
 * Factory for a valid IClassCreateDTO.
 */
function makeCreateDTO(overrides: Partial<IClassCreateDTO> = {}): IClassCreateDTO {
  return {
    id: 'class-id-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'TestClass',
    ...overrides,
  };
}

describe('ClassRepository', () => {
  let mockAdapter: IDatabaseAdapter;
  let repository: ClassRepository;

  beforeEach(() => {
    mockAdapter = createMockDatabaseAdapter();
    repository = new ClassRepository(mockAdapter);
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should insert a class and return a Class instance', async () => {
      const dto = makeCreateDTO();
      const row = mockClassRow();

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]);

      const result = await repository.create(dto);

      expect(result).toBeInstanceOf(Class);
      expect(result.id).toBe('class-id-1');
      expect(result.package_id).toBe('pkg-1');
      expect(result.module_id).toBe('mod-1');
      expect(result.name).toBe('TestClass');
      expect(result.extends_id).toBeUndefined();
    });

    it('should pass correct SQL and parameters to the adapter', async () => {
      const dto = makeCreateDTO({ extends_id: 'parent-class-id' });
      const row = mockClassRow({ extends_id: 'parent-class-id' });

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]);

      await repository.create(dto);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        'INSERT INTO classes (id, package_id, module_id, name, extends_id) VALUES (?, ?, ?, ?, ?) RETURNING *',
        ['class-id-1', 'pkg-1', 'mod-1', 'TestClass', 'parent-class-id']
      );
    });

    it('should pass null for extends_id when not provided', async () => {
      const dto = makeCreateDTO();
      const row = mockClassRow();

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]);

      await repository.create(dto);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [
        'class-id-1',
        'pkg-1',
        'mod-1',
        'TestClass',
        null,
      ]);
    });

    it('should return a Class with extends_id when the row includes one', async () => {
      const dto = makeCreateDTO({ extends_id: 'parent-class-id' });
      const row = mockClassRow({ extends_id: 'parent-class-id' });

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]);

      const result = await repository.create(dto);

      expect(result.extends_id).toBe('parent-class-id');
    });

    it('should throw RepositoryError when the adapter returns an empty array', async () => {
      const dto = makeCreateDTO();

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await expect(repository.create(dto)).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when the adapter throws', async () => {
      const dto = makeCreateDTO();

      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('connection lost'));

      await expect(repository.create(dto)).rejects.toThrow(RepositoryError);
    });

    it('should include the original error as the cause', async () => {
      const dto = makeCreateDTO();
      const originalError = new Error('disk full');

      vi.mocked(mockAdapter.query).mockRejectedValueOnce(originalError);

      try {
        await repository.create(dto);
        expect.unreachable('Expected create to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryError);
        expect((error as RepositoryError).cause).toBeInstanceOf(Error);
      }
    });

    it('should return a Class with empty methods, properties, and interfaces maps', async () => {
      const dto = makeCreateDTO();
      const row = mockClassRow();

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]);

      const result = await repository.create(dto);

      expect(result.methods).toBeInstanceOf(Map);
      expect((result.methods as Map<string, unknown>).size).toBe(0);
      expect(result.properties).toBeInstanceOf(Map);
      expect((result.properties as Map<string, unknown>).size).toBe(0);
      expect(result.implemented_interfaces).toBeInstanceOf(Map);
      expect((result.implemented_interfaces as Map<string, unknown>).size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should execute an UPDATE query and return the updated Class', async () => {
      // First call: the UPDATE query
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      // Subsequent calls: retrieve after update (retrieve -> methods -> properties -> implementations)
      const updatedRow = mockClassRow({ name: 'RenamedClass' });
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([updatedRow]); // retrieve query
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // methods
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // properties
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // implementations

      const result = await repository.update('class-id-1', { name: 'RenamedClass' });

      expect(result).toBeInstanceOf(Class);
      expect(result.name).toBe('RenamedClass');
    });

    it('should pass the correct SET clause for name updates', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      const updatedRow = mockClassRow({ name: 'NewName' });
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([updatedRow]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.update('class-id-1', { name: 'NewName' });

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      expect(firstCall[0]).toContain('UPDATE classes SET name = ? WHERE id = ?');
      expect(firstCall[1]).toEqual(['NewName', 'class-id-1']);
    });

    it('should pass the correct SET clause for extends_id updates', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      const updatedRow = mockClassRow({ extends_id: 'new-parent-id' });
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([updatedRow]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.update('class-id-1', { extends_id: 'new-parent-id' });

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      expect(firstCall[0]).toContain('UPDATE classes SET extends_id = ? WHERE id = ?');
      expect(firstCall[1]).toEqual(['new-parent-id', 'class-id-1']);
    });

    it('should throw RepositoryError when the class is not found after update', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // update
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // retrieve returns nothing

      await expect(repository.update('nonexistent', { name: 'Foo' })).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when the adapter throws during update', async () => {
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('query failed'));

      await expect(repository.update('class-id-1', { name: 'Broken' })).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve
  // ---------------------------------------------------------------------------
  describe('retrieve', () => {
    it('should return all classes when called without arguments', async () => {
      const rows = [mockClassRow({ id: 'cls-1', name: 'ClassA' }), mockClassRow({ id: 'cls-2', name: 'ClassB' })];

      // retrieve query
      vi.mocked(mockAdapter.query).mockResolvedValueOnce(rows);
      // For each class: methods, properties, implementations
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // cls-1 methods
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // cls-1 properties
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // cls-1 implementations
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // cls-2 methods
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // cls-2 properties
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // cls-2 implementations

      const result = await repository.retrieve();

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Class);
      expect(result[1]).toBeInstanceOf(Class);
    });

    it('should build a query without WHERE clause when no arguments provided', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieve();

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('SELECT c.*');
      expect(sql).toContain('FROM classes c');
      expect(sql).not.toContain('WHERE');
    });

    it('should add id condition to WHERE clause', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieve('cls-1');

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('WHERE c.id = ?');
      expect(firstCall[1]).toEqual(['cls-1']);
    });

    it('should add module_id condition to WHERE clause', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieve(undefined, 'mod-1');

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('WHERE c.module_id = ?');
      expect(firstCall[1]).toEqual(['mod-1']);
    });

    it('should combine both id and module_id in WHERE clause', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieve('cls-1', 'mod-1');

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('c.id = ?');
      expect(sql).toContain('AND');
      expect(sql).toContain('c.module_id = ?');
      expect(firstCall[1]).toEqual(['cls-1', 'mod-1']);
    });

    it('should query for implemented interfaces for each class', async () => {
      const row = mockClassRow();

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]); // retrieve
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // methods
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // properties
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // implementations

      await repository.retrieve();

      // The 4th query call should be the implementations query
      const implementationsCall = vi.mocked(mockAdapter.query).mock.calls[3];
      if (implementationsCall === undefined) throw new Error('Implementations call is undefined');
      const sql = implementationsCall[0];
      expect(sql).toContain('FROM interfaces i');
      expect(sql).toContain('JOIN class_implements ci ON i.id = ci.interface_id');
      expect(sql).toContain('WHERE ci.class_id = ?');
      expect(implementationsCall[1]).toEqual(['class-id-1']);
    });

    it('should populate implemented_interfaces on the returned Class', async () => {
      const classRow = mockClassRow();
      const interfaceRow = {
        id: 'iface-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'ISerializable',
        created_at: FIXED_DATE,
      };

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([classRow]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // methods
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // properties
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([interfaceRow]); // implementations

      const results = await repository.retrieve();

      expect(results).toHaveLength(1);
      const cls = results[0];
      if (cls === undefined) throw new Error('expected class');
      const interfaces = cls.implemented_interfaces as Map<string, unknown>;
      expect(interfaces.size).toBe(1);
      expect(interfaces.has('iface-1')).toBe(true);
    });

    it('should throw RepositoryError when the adapter throws', async () => {
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('db error'));

      await expect(repository.retrieve()).rejects.toThrow(RepositoryError);
    });

    it('should re-throw RepositoryError directly without double-wrapping', async () => {
      const repoErr = new RepositoryError('inner', 'retrieve', '[ClassRepository]');
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(repoErr);

      await expect(repository.retrieve()).rejects.toThrow(repoErr);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveById
  // ---------------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should return a Class when found', async () => {
      const row = mockClassRow();

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([row]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // methods
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // properties
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // implementations

      const result = await repository.retrieveById('class-id-1');

      expect(result).toBeInstanceOf(Class);
      expect(result?.id).toBe('class-id-1');
    });

    it('should return undefined when no class is found', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      const result = await repository.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should delegate to retrieve with the id argument', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieveById('cls-42');

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('WHERE c.id = ?');
      expect(firstCall[1]).toEqual(['cls-42']);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByModuleId
  // ---------------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should return classes for a given module_id', async () => {
      const rows = [
        mockClassRow({ id: 'cls-1', module_id: 'mod-1', name: 'A' }),
        mockClassRow({ id: 'cls-2', module_id: 'mod-1', name: 'B' }),
      ];

      vi.mocked(mockAdapter.query).mockResolvedValueOnce(rows);
      // methods/properties/implementations for each class
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      const result = await repository.retrieveByModuleId('mod-1');

      expect(result).toHaveLength(2);
    });

    it('should build the correct WHERE clause for module_id', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieveByModuleId('mod-99');

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('WHERE c.module_id = ?');
      expect(firstCall[1]).toEqual(['mod-99']);
    });

    it('should return empty array when no classes exist in the module', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      const result = await repository.retrieveByModuleId('mod-empty');

      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieveByModuleIds (batch)
  // ---------------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('should return empty array for empty input', async () => {
      const result = await repository.retrieveByModuleIds([]);

      expect(result).toEqual([]);
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should build an IN clause with placeholders for module IDs', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.retrieveByModuleIds(['mod-1', 'mod-2', 'mod-3']);

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('WHERE c.module_id IN (?, ?, ?)');
      expect(firstCall[1]).toEqual(['mod-1', 'mod-2', 'mod-3']);
    });

    it('should return Class instances with empty collections (no hydration)', async () => {
      const rows = [
        mockClassRow({ id: 'cls-1', module_id: 'mod-1', name: 'ClassA' }),
        mockClassRow({ id: 'cls-2', module_id: 'mod-2', name: 'ClassB' }),
      ];

      vi.mocked(mockAdapter.query).mockResolvedValueOnce(rows);

      const result = await repository.retrieveByModuleIds(['mod-1', 'mod-2']);

      expect(result).toHaveLength(2);
      const [first, second] = result;
      if (first === undefined || second === undefined) throw new Error('expected two classes');
      expect(first).toBeInstanceOf(Class);
      expect(second).toBeInstanceOf(Class);
      // These should be empty Maps since retrieveByModuleIds does NOT hydrate
      expect((first.methods as Map<string, unknown>).size).toBe(0);
      expect((first.properties as Map<string, unknown>).size).toBe(0);
    });

    it('should throw RepositoryError when the adapter throws', async () => {
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('batch query failed'));

      await expect(repository.retrieveByModuleIds(['mod-1'])).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('should delete related records before deleting the class', async () => {
      // 4 queries total: class_implements, methods, properties, then the class itself
      vi.mocked(mockAdapter.query).mockResolvedValue([]);

      await repository.delete('cls-to-delete');

      expect(mockAdapter.query).toHaveBeenCalledTimes(4);
    });

    it('should delete class_implements first', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValue([]);

      await repository.delete('cls-to-delete');

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      expect(firstCall[0]).toBe('DELETE FROM class_implements WHERE class_id = ?');
      expect(firstCall[1]).toEqual(['cls-to-delete']);
    });

    it('should delete methods with parent_type class', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValue([]);

      await repository.delete('cls-to-delete');

      const secondCall = vi.mocked(mockAdapter.query).mock.calls[1];
      if (secondCall === undefined) throw new Error('Second call is undefined');
      expect(secondCall[0]).toBe('DELETE FROM methods WHERE parent_id = ? AND parent_type = ?');
      expect(secondCall[1]).toEqual(['cls-to-delete', 'class']);
    });

    it('should delete properties with parent_type class', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValue([]);

      await repository.delete('cls-to-delete');

      const thirdCall = vi.mocked(mockAdapter.query).mock.calls[2];
      if (thirdCall === undefined) throw new Error('Third call is undefined');
      expect(thirdCall[0]).toBe('DELETE FROM properties WHERE parent_id = ? AND parent_type = ?');
      expect(thirdCall[1]).toEqual(['cls-to-delete', 'class']);
    });

    it('should delete the class itself last', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValue([]);

      await repository.delete('cls-to-delete');

      const lastCall = vi.mocked(mockAdapter.query).mock.calls[3];
      if (lastCall === undefined) throw new Error('Last call is undefined');
      expect(lastCall[0]).toBe('DELETE FROM classes WHERE id = ?');
      expect(lastCall[1]).toEqual(['cls-to-delete']);
    });

    it('should throw RepositoryError when the adapter throws during deletion', async () => {
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('FK constraint violation'));

      await expect(repository.delete('cls-to-delete')).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError if a later deletion step fails', async () => {
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]); // class_implements ok
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('methods delete failed')); // methods fails

      await expect(repository.delete('cls-to-delete')).rejects.toThrow(RepositoryError);
    });
  });

  // ---------------------------------------------------------------------------
  // createBatch
  // ---------------------------------------------------------------------------
  describe('createBatch', () => {
    it('should not call the adapter when items array is empty', async () => {
      await repository.createBatch([]);

      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should build a batch INSERT with correct columns and placeholders', async () => {
      const items: IClassCreateDTO[] = [
        makeCreateDTO({ id: 'cls-1', name: 'A' }),
        makeCreateDTO({ id: 'cls-2', name: 'B' }),
      ];

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.createBatch(items);

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const sql = firstCall[0];
      expect(sql).toContain('INSERT INTO classes');
      expect(sql).toContain('(id, package_id, module_id, name, extends_id, start_line, end_line, has_jsdoc)');
      expect(sql).toContain('(?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)');
      const params = firstCall[1] as unknown[];
      // 2 items × 8 columns = 16 params
      expect(params).toHaveLength(16);
    });

    it('should pass null for missing extends_id in batch items', async () => {
      const items: IClassCreateDTO[] = [makeCreateDTO({ id: 'cls-1' })];

      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.createBatch(items);

      const firstCall = vi.mocked(mockAdapter.query).mock.calls[0];
      if (firstCall === undefined) throw new Error('First call is undefined');
      const params = firstCall[1] as unknown[];
      // extends_id is the 5th param (index 4) - should be null when not provided
      expect(params[4]).toBeNull();
    });

    it('should fall back to individual inserts on duplicate key error', async () => {
      const items: IClassCreateDTO[] = [
        makeCreateDTO({ id: 'cls-1', name: 'A' }),
        makeCreateDTO({ id: 'cls-2', name: 'B' }),
      ];

      // Batch insert fails with a duplicate error
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('Duplicate key'));
      // Individual inserts succeed
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      await repository.createBatch(items);

      // 1 batch attempt + 2 individual inserts = 3 total calls
      expect(mockAdapter.query).toHaveBeenCalledTimes(3);
    });

    it('should skip individual duplicates during fallback', async () => {
      const items: IClassCreateDTO[] = [
        makeCreateDTO({ id: 'cls-1', name: 'A' }),
        makeCreateDTO({ id: 'cls-2', name: 'B' }),
      ];

      // Batch insert fails
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('UNIQUE constraint'));
      // First individual insert is a duplicate too
      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('already exists'));
      // Second individual insert succeeds
      vi.mocked(mockAdapter.query).mockResolvedValueOnce([]);

      // Should not throw - duplicates are silently skipped
      await expect(repository.createBatch(items)).resolves.toBeUndefined();
    });

    it('should throw non-duplicate errors during batch insert', async () => {
      const items: IClassCreateDTO[] = [makeCreateDTO({ id: 'cls-1', name: 'A' })];

      vi.mocked(mockAdapter.query).mockRejectedValueOnce(new Error('disk full'));

      await expect(repository.createBatch(items)).rejects.toThrow('disk full');
    });
  });

  // ---------------------------------------------------------------------------
  // constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('should set the table name to classes', () => {
      // Access the protected tableName via a public method's SQL usage
      vi.mocked(mockAdapter.query).mockResolvedValue([]);

      // We can verify via delete which uses this.tableName
      repository.delete('test-id').catch(() => {
        // ignore
      });

      // Give time for async
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const calls = vi.mocked(mockAdapter.query).mock.calls;
          const deleteCall = calls.find((call) => {
            const sql = call[0];
            return typeof sql === 'string' && sql.startsWith('DELETE FROM classes WHERE id');
          });
          expect(deleteCall).toBeDefined();
          resolve();
        }, 10);
      });
    });
  });
});
