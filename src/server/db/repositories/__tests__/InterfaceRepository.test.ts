// @vitest-environment node
import { vi } from 'vitest';

import { Interface } from '../../../../shared/types/Interface';
import { RepositoryError } from '../../errors/RepositoryError';
import { InterfaceRepository } from '../InterfaceRepository';

import type { IInterfaceCreateDTO } from '../InterfaceRepository';
import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';
import type { IClassOrInterfaceRow } from '../../types/DatabaseResults';

/**
 * Creates a fresh mock IDatabaseAdapter for each test.
 */
function createMockAdapter() {
  return {
    query: vi.fn(),
    close: vi.fn(),
    init: vi.fn(),
    transaction: vi.fn(),
    getDbPath: vi.fn(),
  } as unknown as IDatabaseAdapter;
}

/**
 * Helper to build a valid IClassOrInterfaceRow from a DTO.
 */
function buildRow(dto: IInterfaceCreateDTO, createdAt = '2025-01-01T00:00:00.000Z'): IClassOrInterfaceRow {
  return {
    id: dto.id,
    package_id: dto.package_id,
    module_id: dto.module_id,
    name: dto.name,
    created_at: createdAt,
  } as IClassOrInterfaceRow;
}

const SAMPLE_DTO: IInterfaceCreateDTO = {
  id: 'iface-uuid-1',
  package_id: 'pkg-uuid-1',
  module_id: 'mod-uuid-1',
  name: 'IUserService',
};

describe('InterfaceRepository', () => {
  let mockAdapter: IDatabaseAdapter;
  let repo: InterfaceRepository;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    repo = new InterfaceRepository(mockAdapter);
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should insert a new interface and return an Interface instance', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.create(SAMPLE_DTO);

      expect(result).toBeInstanceOf(Interface);
      expect(result.id).toBe(SAMPLE_DTO.id);
      expect(result.package_id).toBe(SAMPLE_DTO.package_id);
      expect(result.module_id).toBe(SAMPLE_DTO.module_id);
      expect(result.name).toBe(SAMPLE_DTO.name);
      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('should pass the correct INSERT SQL and parameters to the adapter', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      await repo.create(SAMPLE_DTO);

      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO interfaces');
      expect(sql).toContain('RETURNING *');
      expect(params[0]).toBe(SAMPLE_DTO.id);
      expect(params[1]).toBe(SAMPLE_DTO.package_id);
      expect(params[2]).toBe(SAMPLE_DTO.module_id);
      expect(params[3]).toBe(SAMPLE_DTO.name);
      // 5th param is the ISO timestamp
      expect(typeof params[4]).toBe('string');
    });

    it('should initialize methods, properties, and extended_interfaces as empty Maps', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.create(SAMPLE_DTO);

      expect(result.methods).toBeInstanceOf(Map);
      expect((result.methods as Map<string, unknown>).size).toBe(0);
      expect(result.properties).toBeInstanceOf(Map);
      expect((result.properties as Map<string, unknown>).size).toBe(0);
      expect(result.extended_interfaces).toBeInstanceOf(Map);
      expect((result.extended_interfaces as Map<string, unknown>).size).toBe(0);
    });

    it('should throw RepositoryError when the adapter returns an empty array', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(repo.create(SAMPLE_DTO)).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when the adapter throws', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(repo.create(SAMPLE_DTO)).rejects.toThrow(RepositoryError);
    });

    it('should preserve the original error as cause when wrapping', async () => {
      const originalError = new Error('constraint violation');
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);

      try {
        await repo.create(SAMPLE_DTO);
        expect.fail('Expected RepositoryError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryError);
        expect((error as RepositoryError).cause).toBeInstanceOf(Error);
      }
    });
  });

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------
  describe('update', () => {
    it('should execute an UPDATE query and return the updated Interface', async () => {
      const updatedRow = buildRow({ ...SAMPLE_DTO, name: 'IUpdatedService' });

      // First call: the UPDATE query
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // Subsequent calls: the retrieve query (SELECT), method/property/extended lookups
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedRow]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // methods
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // properties
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // extended interfaces

      const result = await repo.update(SAMPLE_DTO.id, { name: 'IUpdatedService' });

      expect(result).toBeInstanceOf(Interface);
      expect(result.name).toBe('IUpdatedService');
    });

    it('should build an UPDATE SET clause with the provided fields', async () => {
      const updatedRow = buildRow({ ...SAMPLE_DTO, name: 'IRenamed' });
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedRow]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.update(SAMPLE_DTO.id, { name: 'IRenamed' });

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE interfaces SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('WHERE id = ?');
      expect(params).toContain('IRenamed');
      expect(params).toContain(SAMPLE_DTO.id);
    });

    it('should throw RepositoryError when the interface is not found after update', async () => {
      // UPDATE succeeds
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // Retrieve returns empty
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(repo.update(SAMPLE_DTO.id, { name: 'INotFound' })).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when the adapter throws during update', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('update failed'));

      await expect(repo.update(SAMPLE_DTO.id, { name: 'IFailing' })).rejects.toThrow(RepositoryError);
    });
  });

  // --------------------------------------------------------------------------
  // retrieve
  // --------------------------------------------------------------------------
  describe('retrieve', () => {
    it('should return an array of Interface instances', async () => {
      const row = buildRow(SAMPLE_DTO);
      // Main SELECT
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      // methods for first interface
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // properties for first interface
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // extended interfaces
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const results = await repo.retrieve();

      expect(results).toHaveLength(1);
      const first = results[0];
      expect(first).toBeInstanceOf(Interface);
      expect(first).toBeDefined();
      expect(first?.id).toBe(SAMPLE_DTO.id);
    });

    it('should include WHERE clause for id when provided', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve('some-id');

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('i.id = ?');
      expect(params).toContain('some-id');
    });

    it('should include WHERE clause for module_id when provided', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve(undefined, 'mod-123');

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('i.module_id = ?');
      expect(params).toContain('mod-123');
    });

    it('should include both WHERE conditions when id and module_id are given', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve('id-1', 'mod-1');

      const [sql] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('i.id = ?');
      expect(sql).toContain('i.module_id = ?');
      expect(sql).toContain('AND');
    });

    it('should have no WHERE clause when neither id nor module_id is given', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.retrieve();

      const [sql] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('WHERE');
    });

    it('should return empty array when no results found', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const results = await repo.retrieve();

      expect(results).toEqual([]);
    });

    it('should fetch extended interfaces via the join query', async () => {
      const ifaceRow = buildRow(SAMPLE_DTO);
      const extendedRow = buildRow({
        id: 'ext-iface-1',
        package_id: 'pkg-uuid-1',
        module_id: 'mod-uuid-1',
        name: 'IBaseService',
      });

      // Main query
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([ifaceRow]);
      // methods
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // properties
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // extended interfaces query
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([extendedRow]);

      const results = await repo.retrieve(SAMPLE_DTO.id);

      expect(results).toHaveLength(1);
      const iface = results[0];
      expect(iface).toBeDefined();
      expect(iface?.extended_interfaces).toBeInstanceOf(Map);
      const extMap = iface?.extended_interfaces as Map<string, Interface>;
      expect(extMap.size).toBe(1);
      expect(extMap.get('ext-iface-1')?.name).toBe('IBaseService');
    });

    it('should handle multiple interfaces with their own extended interfaces', async () => {
      const row1 = buildRow(SAMPLE_DTO);
      const row2 = buildRow({
        id: 'iface-uuid-2',
        package_id: 'pkg-uuid-1',
        module_id: 'mod-uuid-1',
        name: 'IRepository',
      });

      // Main query returns 2 rows
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row1, row2]);
      // Methods/properties/extended for interface 1
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // methods
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // properties
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // extended
      // Methods/properties/extended for interface 2
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // methods
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // properties
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // extended

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('IUserService');
      expect(results[1]?.name).toBe('IRepository');
    });

    it('should throw RepositoryError when the adapter throws', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connection lost'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });

    it('should re-throw RepositoryError without double-wrapping', async () => {
      const repoErr = new RepositoryError('inner error', 'retrieve', '[InterfaceRepository]');
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(repoErr);

      try {
        await repo.retrieve();
        expect.fail('Expected RepositoryError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryError);
        // The error should be the original or a wrapper with the original as cause
        expect((error as RepositoryError).message).toContain('inner error');
      }
    });
  });

  // --------------------------------------------------------------------------
  // retrieveById
  // --------------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should return an Interface when found', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // methods
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // properties
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // extended

      const result = await repo.retrieveById(SAMPLE_DTO.id);

      expect(result).toBeInstanceOf(Interface);
      expect(result?.id).toBe(SAMPLE_DTO.id);
    });

    it('should return undefined when not found', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('non-existent-id');

      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // retrieveByModuleId
  // --------------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should delegate to retrieve with module_id', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const results = await repo.retrieveByModuleId('mod-uuid-1');

      expect(results).toHaveLength(1);
      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('i.module_id = ?');
      expect(params).toContain('mod-uuid-1');
    });
  });

  // --------------------------------------------------------------------------
  // retrieveByModuleIds
  // --------------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('should return empty array for empty input', async () => {
      const results = await repo.retrieveByModuleIds([]);

      expect(results).toEqual([]);
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should build an IN clause with placeholders for each module ID', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      await repo.retrieveByModuleIds(['mod-1', 'mod-2', 'mod-3']);

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE i.module_id IN');
      expect(sql).toContain('?, ?, ?');
      expect(params).toEqual(['mod-1', 'mod-2', 'mod-3']);
    });

    it('should return lightweight Interface instances without hydrated relations', async () => {
      const row = buildRow(SAMPLE_DTO);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const results = await repo.retrieveByModuleIds(['mod-uuid-1']);

      expect(results).toHaveLength(1);
      const first = results[0];
      expect(first).toBeInstanceOf(Interface);
      expect(first?.id).toBe(SAMPLE_DTO.id);
      // Should only call query once (no hydration calls)
      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
    });

    it('should throw RepositoryError when adapter throws', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('query failed'));

      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(RepositoryError);
    });
  });

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should delete related methods, properties, then the interface itself', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.delete(SAMPLE_DTO.id);

      expect(mockAdapter.query).toHaveBeenCalledTimes(3);
    });

    it('should delete methods first with the correct SQL', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.delete(SAMPLE_DTO.id);

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM methods');
      expect(sql).toContain('parent_id = ?');
      expect(sql).toContain('parent_type = ?');
      expect(params).toEqual([SAMPLE_DTO.id, 'interface']);
    });

    it('should delete properties second with the correct SQL', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.delete(SAMPLE_DTO.id);

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM properties');
      expect(sql).toContain('parent_id = ?');
      expect(sql).toContain('parent_type = ?');
      expect(params).toEqual([SAMPLE_DTO.id, 'interface']);
    });

    it('should delete the interface record last', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await repo.delete(SAMPLE_DTO.id);

      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[2] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM interfaces');
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual([SAMPLE_DTO.id]);
    });

    it('should throw RepositoryError when deleting methods fails', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('FK violation'));

      await expect(repo.delete(SAMPLE_DTO.id)).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when deleting the interface fails', async () => {
      (mockAdapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // methods deleted OK
        .mockResolvedValueOnce([]) // properties deleted OK
        .mockRejectedValueOnce(new Error('delete failed')); // interface delete fails

      await expect(repo.delete(SAMPLE_DTO.id)).rejects.toThrow(RepositoryError);
    });
  });

  // --------------------------------------------------------------------------
  // createBatch
  // --------------------------------------------------------------------------
  describe('createBatch', () => {
    it('should insert multiple interfaces in a single batch query', async () => {
      const items: IInterfaceCreateDTO[] = [
        { id: 'id-1', package_id: 'pkg-1', module_id: 'mod-1', name: 'IFirst' },
        { id: 'id-2', package_id: 'pkg-1', module_id: 'mod-1', name: 'ISecond' },
      ];

      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.createBatch(items);

      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (mockAdapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO interfaces');
      expect(sql).toContain('(id, package_id, module_id, name, created_at)');
      // Two rows, 5 columns each = 10 params
      expect(params).toHaveLength(10);
      expect(params[0]).toBe('id-1');
      expect(params[5]).toBe('id-2');
    });

    it('should do nothing for an empty array', async () => {
      await repo.createBatch([]);

      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('should handle duplicate key errors by falling back to individual inserts', async () => {
      const items: IInterfaceCreateDTO[] = [
        { id: 'id-1', package_id: 'pkg-1', module_id: 'mod-1', name: 'IFirst' },
        { id: 'id-2', package_id: 'pkg-1', module_id: 'mod-1', name: 'ISecond' },
      ];

      // First call (batch) fails with duplicate error
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Duplicate key'));
      // Individual inserts: first succeeds, second fails with duplicate (ignored)
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Duplicate key'));

      await expect(repo.createBatch(items)).resolves.toBeUndefined();
    });

    it('should re-throw non-duplicate errors during batch insert', async () => {
      const items: IInterfaceCreateDTO[] = [
        { id: 'id-1', package_id: 'pkg-1', module_id: 'mod-1', name: 'IFirst' },
      ];

      (mockAdapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('Disk full');
    });
  });

  // --------------------------------------------------------------------------
  // constructor
  // --------------------------------------------------------------------------
  describe('constructor', () => {
    it('should set the table name to "interfaces"', () => {
      // Access the protected tableName through a type assertion
      const tableName = (repo as unknown as { tableName: string }).tableName;
      expect(tableName).toBe('interfaces');
    });

    it('should set the errorTag to "[InterfaceRepository]"', () => {
      const errorTag = (repo as unknown as { errorTag: string }).errorTag;
      expect(errorTag).toBe('[InterfaceRepository]');
    });
  });
});
