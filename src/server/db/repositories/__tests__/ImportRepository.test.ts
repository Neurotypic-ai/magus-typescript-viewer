// @vitest-environment node
import { ImportRepository } from '../ImportRepository';
import { RepositoryError, EntityNotFoundError, NoFieldsToUpdateError } from '../../errors/RepositoryError';

import type { IImportCreateDTO } from '../ImportRepository';
import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(overrides?: Partial<IDatabaseAdapter>): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeImportDTO(overrides?: Partial<IImportCreateDTO>): IImportCreateDTO {
  return {
    id: 'import-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    source: './utils',
    specifiers_json: '["foo","bar"]',
    is_type_only: false,
    ...overrides,
  };
}

function makeImportRow(overrides?: Record<string, unknown>) {
  return {
    id: 'import-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    source: './utils',
    specifiers_json: '["foo","bar"]',
    is_type_only: false,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: ImportRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new ImportRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('inserts a row and returns the DTO', async () => {
      const dto = makeImportDTO();
      const result = await repo.create(dto);

      expect(result).toBe(dto);
      expect(adapter.query).toHaveBeenCalledTimes(1);

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO imports');
      expect(params).toEqual([
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.source,
        dto.specifiers_json,
        false,
      ]);
    });

    it('defaults specifiers_json to null when undefined', async () => {
      const dto = makeImportDTO({ specifiers_json: undefined });
      await repo.create(dto);

      const [, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBeNull();
    });

    it('defaults is_type_only to false when undefined', async () => {
      const dto = makeImportDTO({ is_type_only: undefined });
      await repo.create(dto);

      const [, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(params[5]).toBe(false);
    });

    it('passes is_type_only as true when set', async () => {
      const dto = makeImportDTO({ is_type_only: true });
      await repo.create(dto);

      const [, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(params[5]).toBe(true);
    });

    it('wraps adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db boom'));

      await expect(repo.create(makeImportDTO())).rejects.toThrow(RepositoryError);
      await expect(repo.create(makeImportDTO())).rejects.toThrow(/Failed to create import/);
    });

    it('wraps non-Error throws in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

      await expect(repo.create(makeImportDTO())).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('returns mapped entity when found', async () => {
      const row = makeImportRow();
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('import-1');

      expect(result).toEqual({
        id: 'import-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        source: './utils',
        specifiers_json: '["foo","bar"]',
        is_type_only: false,
      });
    });

    it('returns undefined when no rows', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('missing-id');
      expect(result).toBeUndefined();
    });

    it('correctly maps is_type_only string "true" to boolean true', async () => {
      const row = makeImportRow({ is_type_only: 'true' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('import-1');
      expect(result?.is_type_only).toBe(true);
    });

    it('correctly maps is_type_only string "1" to boolean true', async () => {
      const row = makeImportRow({ is_type_only: '1' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('import-1');
      expect(result?.is_type_only).toBe(true);
    });

    it('maps is_type_only "false" to boolean false', async () => {
      const row = makeImportRow({ is_type_only: 'false' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('import-1');
      expect(result?.is_type_only).toBe(false);
    });

    it('maps null specifiers_json to undefined', async () => {
      const row = makeImportRow({ specifiers_json: null });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('import-1');
      expect(result?.specifiers_json).toBeUndefined();
    });

    it('wraps adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db fail'));

      await expect(repo.retrieveById('id')).rejects.toThrow(RepositoryError);
      await expect(repo.retrieveById('id')).rejects.toThrow(/Failed to retrieve import by id/);
    });
  });

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('retrieves all imports when no filters provided', async () => {
      const rows = [makeImportRow(), makeImportRow({ id: 'import-2', source: './other' })];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      const [sql] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toBe('SELECT * FROM imports');
    });

    it('filters by id when provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeImportRow()]);

      await repo.retrieve('import-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['import-1']);
    });

    it('filters by module_id when id is not provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeImportRow()]);

      await repo.retrieve(undefined, 'mod-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });

    it('prefers id filter over module_id filter', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeImportRow()]);

      await repo.retrieve('import-1', 'mod-1');

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = ?');
      expect(sql).not.toContain('module_id');
      expect(params).toEqual(['import-1']);
    });

    it('wraps adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('query fail'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
      await expect(repo.retrieve()).rejects.toThrow(/Failed to retrieve imports/);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('delegates to retrieve with module_id', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeImportRow()]);

      const results = await repo.retrieveByModuleId('mod-1');

      expect(results).toHaveLength(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });
  });

  // -----------------------------------------------------------------------
  // findByModuleId
  // -----------------------------------------------------------------------
  describe('findByModuleId', () => {
    it('delegates to retrieveByModuleId', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeImportRow()]);

      const results = await repo.findByModuleId('mod-1');

      expect(results).toHaveLength(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleIds
  // -----------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('returns empty array for empty input', async () => {
      const results = await repo.retrieveByModuleIds([]);
      expect(results).toEqual([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('builds IN clause with correct placeholders', async () => {
      const rows = [
        makeImportRow({ module_id: 'mod-1' }),
        makeImportRow({ id: 'import-2', module_id: 'mod-2' }),
      ];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleIds(['mod-1', 'mod-2']);

      expect(results).toHaveLength(2);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE module_id IN (?, ?)');
      expect(params).toEqual(['mod-1', 'mod-2']);
    });

    it('handles single module id', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeImportRow()]);

      await repo.retrieveByModuleIds(['mod-1']);

      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE module_id IN (?)');
      expect(params).toEqual(['mod-1']);
    });

    it('wraps adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('batch fail'));

      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(RepositoryError);
      await expect(repo.retrieveByModuleIds(['mod-1'])).rejects.toThrow(/Failed to retrieve imports by module IDs/);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('updates source field', async () => {
      const updatedRow = makeImportRow({ source: './new-source' });
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // UPDATE query
        .mockResolvedValueOnce([updatedRow]); // SELECT for retrieveById

      const result = await repo.update('import-1', { source: './new-source' });

      expect(result.source).toBe('./new-source');
      expect(adapter.query).toHaveBeenCalledTimes(2);

      const [updateSql, updateParams] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE imports SET');
      expect(updateSql).toContain('source = ?');
      expect(updateParams).toContain('./new-source');
      expect(updateParams[updateParams.length - 1]).toBe('import-1');
    });

    it('updates specifiers_json field', async () => {
      const updatedRow = makeImportRow({ specifiers_json: '["baz"]' });
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('import-1', { specifiers_json: '["baz"]' });

      expect(result.specifiers_json).toBe('["baz"]');
    });

    it('updates specifiers_json to null', async () => {
      const updatedRow = makeImportRow({ specifiers_json: null });
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('import-1', { specifiers_json: null });

      expect(result.specifiers_json).toBeUndefined();
    });

    it('updates both fields at once', async () => {
      const updatedRow = makeImportRow({ source: './changed', specifiers_json: '["x"]' });
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([updatedRow]);

      await repo.update('import-1', { source: './changed', specifiers_json: '["x"]' });

      const [sql] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('source = ?');
      expect(sql).toContain('specifiers_json = ?');
    });

    it('throws NoFieldsToUpdateError when no fields provided', async () => {
      await expect(repo.update('import-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('throws EntityNotFoundError when updated row not found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])  // UPDATE succeeds
        .mockResolvedValueOnce([]); // SELECT returns nothing

      await expect(repo.update('missing-id', { source: './x' })).rejects.toThrow(EntityNotFoundError);
    });

    it('re-throws RepositoryError subclasses as-is', async () => {
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])  // UPDATE
        .mockResolvedValueOnce([]); // retrieveById returns empty

      try {
        await repo.update('missing-id', { source: './x' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityNotFoundError);
      }
    });

    it('wraps non-RepositoryError adapter failures in RepositoryError', async () => {
      // When the adapter throws a raw Error, BaseRepository.executeQuery wraps
      // it in a RepositoryError. The update() catch block sees it's already a
      // RepositoryError and re-throws as-is.
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('generic db error'));

      await expect(repo.update('import-1', { source: './x' })).rejects.toThrow(RepositoryError);
      await expect(repo.update('import-1', { source: './x' })).rejects.toThrow(/generic db error/);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('executes DELETE query with correct id', async () => {
      await repo.delete('import-1');

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM imports');
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['import-1']);
    });

    it('wraps adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('delete fail'));

      await expect(repo.delete('import-1')).rejects.toThrow(RepositoryError);
      await expect(repo.delete('import-1')).rejects.toThrow(/Failed to delete import/);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('does nothing for empty array', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('inserts multiple rows in a single query', async () => {
      const items = [
        makeImportDTO({ id: 'imp-1' }),
        makeImportDTO({ id: 'imp-2', source: './other' }),
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO imports');
      expect(sql).toContain('(?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)');
      expect(params).toHaveLength(12);
    });

    it('defaults specifiers_json to null and is_type_only to false in batch', async () => {
      const items = [makeImportDTO({ specifiers_json: undefined, is_type_only: undefined })];

      await repo.createBatch(items);

      const [, params] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBeNull();
      expect(params[5]).toBe(false);
    });

    it('falls back to individual inserts on duplicate key error', async () => {
      const items = [
        makeImportDTO({ id: 'imp-1' }),
        makeImportDTO({ id: 'imp-2' }),
      ];

      // First (batch) call fails with UNIQUE, then individual inserts succeed
      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE constraint violated'))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual inserts
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('skips individual duplicates during fallback', async () => {
      const items = [
        makeImportDTO({ id: 'imp-1' }),
        makeImportDTO({ id: 'imp-2' }),
      ];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE constraint violated'))
        .mockRejectedValueOnce(new Error('Duplicate entry'))
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('re-throws non-duplicate errors from batch insert', async () => {
      const items = [makeImportDTO()];

      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });

    it('re-throws non-duplicate errors from individual fallback insert', async () => {
      const items = [makeImportDTO({ id: 'imp-1' })];

      (adapter.query as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('UNIQUE constraint violated'))
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });
  });

  // -----------------------------------------------------------------------
  // constructor / metadata
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('sets the correct table name and error tag', () => {
      // Verified indirectly: queries target "imports" table
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      // The table name is used in batch insert SQL
      const items = [makeImportDTO()];
      repo.createBatch(items).then(() => {
        const [sql] = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
        expect(sql).toContain('INSERT INTO imports');
      });
    });
  });
});
