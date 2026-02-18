/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { vi } from 'vitest';

import { SymbolReferenceRepository } from '../SymbolReferenceRepository';
import { RepositoryError, EntityNotFoundError } from '../../errors/RepositoryError';

import type { IDatabaseAdapter, DatabaseRow } from '../../adapter/IDatabaseAdapter';
import type { ISymbolReferenceCreateDTO } from '../SymbolReferenceRepository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn<IDatabaseAdapter['init']>().mockResolvedValue(undefined),
    query: vi.fn<IDatabaseAdapter['query']>().mockResolvedValue([]),
    close: vi.fn<IDatabaseAdapter['close']>().mockResolvedValue(undefined),
    transaction: vi.fn<IDatabaseAdapter['transaction']>(),
    getDbPath: vi.fn<IDatabaseAdapter['getDbPath']>().mockReturnValue(':memory:'),
  };
}

function makeDTO(overrides: Partial<ISymbolReferenceCreateDTO> = {}): ISymbolReferenceCreateDTO {
  return {
    id: 'ref-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    source_symbol_id: 'src-1',
    source_symbol_type: 'class',
    source_symbol_name: 'MyClass',
    target_symbol_id: 'tgt-1',
    target_symbol_type: 'method',
    target_symbol_name: 'doStuff',
    access_kind: 'method',
    qualifier_name: 'this',
    ...overrides,
  };
}

function makeRow(overrides: Partial<ISymbolReferenceCreateDTO> = {}): DatabaseRow & Record<string, unknown> {
  const dto = makeDTO(overrides);
  return {
    id: dto.id,
    package_id: dto.package_id,
    module_id: dto.module_id,
    source_symbol_id: dto.source_symbol_id ?? null,
    source_symbol_type: dto.source_symbol_type,
    source_symbol_name: dto.source_symbol_name ?? null,
    target_symbol_id: dto.target_symbol_id,
    target_symbol_type: dto.target_symbol_type,
    target_symbol_name: dto.target_symbol_name,
    access_kind: dto.access_kind,
    qualifier_name: dto.qualifier_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SymbolReferenceRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: SymbolReferenceRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new SymbolReferenceRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('inserts a row and returns the DTO', async () => {
      const dto = makeDTO();
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.create(dto);

      expect(result).toEqual(dto);
      expect(adapter.query).toHaveBeenCalledTimes(1);

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO symbol_references');
      expect(params).toEqual([
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.source_symbol_id,
        dto.source_symbol_type,
        dto.source_symbol_name,
        dto.target_symbol_id,
        dto.target_symbol_type,
        dto.target_symbol_name,
        dto.access_kind,
        dto.qualifier_name,
      ]);
    });

    it('passes null for optional undefined fields', async () => {
      const dto = makeDTO({
        source_symbol_id: undefined,
        source_symbol_name: undefined,
        qualifier_name: undefined,
      });
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.create(dto);

      const [, params] = vi.mocked(adapter.query).mock.calls[0]!;
      // source_symbol_id (index 3), source_symbol_name (index 5), qualifier_name (index 10)
      expect(params![3]).toBeNull();
      expect(params![5]).toBeNull();
      expect(params![10]).toBeNull();
    });

    it('throws RepositoryError when the adapter rejects', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('connection lost'));

      await expect(repo.create(makeDTO())).rejects.toThrow(RepositoryError);
      await expect(repo.create(makeDTO())).rejects.toThrow(/Failed to create symbol reference/);
    });

    it('wraps non-Error throws in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce('string error');

      await expect(repo.create(makeDTO())).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('does nothing for an empty array', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('inserts a single-item batch', async () => {
      const dto = makeDTO();
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.createBatch([dto]);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO symbol_references');
      expect(sql).toContain('VALUES');
    });

    it('inserts multiple items in one statement', async () => {
      const items = [makeDTO({ id: 'r1' }), makeDTO({ id: 'r2' }), makeDTO({ id: 'r3' })];
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      // 3 rows x 11 columns = 33 params
      expect(params).toHaveLength(33);
      // Should have 3 placeholder groups
      const placeholderGroups = sql.match(/\([\s,?]+\)/g);
      expect(placeholderGroups).toHaveLength(3);
    });

    it('falls back to individual inserts on duplicate key errors', async () => {
      const items = [makeDTO({ id: 'r1' }), makeDTO({ id: 'r2' })];

      // First call (batch) fails with UNIQUE constraint
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        // Individual inserts succeed
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual inserts
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('skips individual duplicates during fallback', async () => {
      const items = [makeDTO({ id: 'r1' }), makeDTO({ id: 'r2' })];

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        // First individual insert also fails with duplicate
        .mockRejectedValueOnce(new Error('UNIQUE constraint'))
        // Second individual insert succeeds
        .mockResolvedValueOnce([]);

      // Should not throw
      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('re-throws non-duplicate errors from the batch insert', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.createBatch([makeDTO()])).rejects.toThrow('disk full');
    });

    it('re-throws non-duplicate errors from individual fallback inserts', async () => {
      const items = [makeDTO({ id: 'r1' })];

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate key'))
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('returns the mapped DTO when a row is found', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ref-1');

      expect(result).toEqual(makeDTO());
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM symbol_references WHERE id = ?');
      expect(params).toEqual(['ref-1']);
    });

    it('returns undefined when no row is found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });

    it('maps null row fields to undefined in the DTO', async () => {
      const row = makeRow({
        source_symbol_id: undefined,
        source_symbol_name: undefined,
        qualifier_name: undefined,
      });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ref-1');

      expect(result!.source_symbol_id).toBeUndefined();
      expect(result!.source_symbol_name).toBeUndefined();
      expect(result!.qualifier_name).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('returns all rows when called with no arguments', async () => {
      const rows = [makeRow({ id: 'r1' }), makeRow({ id: 'r2' })];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const result = await repo.retrieve();

      expect(result).toHaveLength(2);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toBe('SELECT * FROM symbol_references');
      expect(params).toEqual([]);
    });

    it('filters by id when id is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow({ id: 'r1' })]);

      const result = await repo.retrieve('r1');

      expect(result).toHaveLength(1);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['r1']);
    });

    it('filters by module_id when module_id is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow()]);

      const result = await repo.retrieve(undefined, 'mod-1');

      expect(result).toHaveLength(1);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });

    it('prefers id filter when both id and module_id are given', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow()]);

      await repo.retrieve('r1', 'mod-1');

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['r1']);
    });

    it('returns an empty array when no rows match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieve(undefined, 'nonexistent');

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('delegates to retrieve with module_id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow()]);

      const result = await repo.retrieveByModuleId('mod-1');

      expect(result).toHaveLength(1);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleIds
  // -----------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('returns an empty array for an empty moduleIds list', async () => {
      const result = await repo.retrieveByModuleIds([]);

      expect(result).toEqual([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('queries with IN clause for multiple module IDs', async () => {
      const rows = [makeRow({ id: 'r1', module_id: 'mod-1' }), makeRow({ id: 'r2', module_id: 'mod-2' })];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const result = await repo.retrieveByModuleIds(['mod-1', 'mod-2']);

      expect(result).toHaveLength(2);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id IN (?, ?)');
      expect(params).toEqual(['mod-1', 'mod-2']);
    });

    it('queries with a single placeholder for one module ID', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow()]);

      await repo.retrieveByModuleIds(['mod-1']);

      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id IN (?)');
      expect(params).toEqual(['mod-1']);
    });

    it('re-throws RepositoryError as-is', async () => {
      const repoError = new RepositoryError('test', 'retrieveByModuleIds', '[SymbolReferenceRepository]');
      vi.mocked(adapter.query).mockRejectedValueOnce(repoError);

      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(repoError);
    });

    it('wraps non-RepositoryError in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('timeout'));

      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(RepositoryError);
      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(/timeout/);
    });
  });

  // -----------------------------------------------------------------------
  // findByModuleId
  // -----------------------------------------------------------------------
  describe('findByModuleId', () => {
    it('delegates to retrieveByModuleId', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow()]);

      const result = await repo.findByModuleId('mod-1');

      expect(result).toHaveLength(1);
      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('WHERE module_id = ?');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('updates specified fields and returns the updated entity', async () => {
      const updatedRow = makeRow({ target_symbol_name: 'newMethod' });

      vi.mocked(adapter.query)
        // UPDATE query
        .mockResolvedValueOnce([])
        // retrieveById after update
        .mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('ref-1', { target_symbol_name: 'newMethod' });

      expect(result.target_symbol_name).toBe('newMethod');
      expect(adapter.query).toHaveBeenCalledTimes(2);

      const [updateSql, updateParams] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(updateSql).toContain('UPDATE symbol_references SET');
      expect(updateSql).toContain('target_symbol_name = ?');
      expect(updateSql).toContain('WHERE id = ?');
      expect(updateParams).toContain('newMethod');
      expect(updateParams).toContain('ref-1');
    });

    it('updates multiple fields at once', async () => {
      const updatedRow = makeRow({
        target_symbol_name: 'renamed',
        access_kind: 'property',
        qualifier_name: 'self',
      });

      vi.mocked(adapter.query)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('ref-1', {
        target_symbol_name: 'renamed',
        access_kind: 'property',
        qualifier_name: 'self',
      });

      expect(result.target_symbol_name).toBe('renamed');
      expect(result.access_kind).toBe('property');
      expect(result.qualifier_name).toBe('self');

      const [updateSql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(updateSql).toContain('target_symbol_name = ?');
      expect(updateSql).toContain('access_kind = ?');
      expect(updateSql).toContain('qualifier_name = ?');
    });

    it('throws EntityNotFoundError when the updated row does not exist', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([])   // UPDATE succeeds
        .mockResolvedValueOnce([]);  // retrieveById returns nothing

      await expect(repo.update('nonexistent', { target_symbol_name: 'x' })).rejects.toThrow(
        EntityNotFoundError
      );
    });

    it('re-throws RepositoryError as-is', async () => {
      const repoError = new RepositoryError('test', 'update', '[SymbolReferenceRepository]');
      vi.mocked(adapter.query).mockRejectedValueOnce(repoError);

      await expect(repo.update('ref-1', { target_symbol_name: 'x' })).rejects.toThrow(repoError);
    });

    it('wraps unexpected errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new TypeError('unexpected'));

      await expect(repo.update('ref-1', { target_symbol_name: 'x' })).rejects.toThrow(
        RepositoryError
      );
      await expect(repo.update('ref-1', { target_symbol_name: 'x' })).rejects.toThrow(
        /unexpected/
      );
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('executes a DELETE query with the given id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('ref-1');

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('DELETE FROM symbol_references WHERE id = ?');
      expect(params).toEqual(['ref-1']);
    });
  });

  // -----------------------------------------------------------------------
  // Row mapping (private mapRow exercised via public methods)
  // -----------------------------------------------------------------------
  describe('row mapping', () => {
    it('maps all non-null row fields to DTO properties', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ref-1');

      expect(result).toEqual({
        id: 'ref-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        source_symbol_id: 'src-1',
        source_symbol_type: 'class',
        source_symbol_name: 'MyClass',
        target_symbol_id: 'tgt-1',
        target_symbol_type: 'method',
        target_symbol_name: 'doStuff',
        access_kind: 'method',
        qualifier_name: 'this',
      });
    });

    it('converts null fields to undefined', async () => {
      const row = {
        id: 'ref-2',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        source_symbol_id: null,
        source_symbol_type: 'module',
        source_symbol_name: null,
        target_symbol_id: 'tgt-2',
        target_symbol_type: 'property',
        target_symbol_name: 'value',
        access_kind: 'property',
        qualifier_name: null,
      };
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ref-2');

      expect(result!.source_symbol_id).toBeUndefined();
      expect(result!.source_symbol_name).toBeUndefined();
      expect(result!.qualifier_name).toBeUndefined();
      // Non-nullable fields should still be present
      expect(result!.id).toBe('ref-2');
      expect(result!.target_symbol_id).toBe('tgt-2');
      expect(result!.target_symbol_type).toBe('property');
    });
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('sets the correct table name', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.retrieve();

      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('symbol_references');
    });
  });
});
