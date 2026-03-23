/* eslint-disable @typescript-eslint/unbound-method -- adapter.query is a vi.fn() mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockDatabaseAdapter } from '../../__tests__/mockDatabaseAdapter';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../../errors/RepositoryError';
import { ExportRepository } from '../ExportRepository';

import type { IExportCreateDTO } from '../../../../shared/types/dto/ExportDTO';
import type { DatabaseRow, IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';

type AdapterQueryCall = [string, unknown[]];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeExportDTO(partial: Partial<IExportCreateDTO> = {}): IExportCreateDTO {
  return {
    id: 'export-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'MyExport',
    is_default: false,
    ...partial,
  };
}

function makeExportRow(
  partial: Partial<IExportCreateDTO> = {}
): DatabaseRow & IExportCreateDTO & { created_at: string } {
  return {
    id: 'export-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'MyExport',
    is_default: false,
    created_at: '2025-01-01T00:00:00Z',
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ExportRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: ExportRepository;

  beforeEach(() => {
    adapter = createMockDatabaseAdapter();
    repo = new ExportRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('should insert a row and return the DTO', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const dto = makeExportDTO();
      const result = await repo.create(dto);

      expect(result).toEqual(dto);
      expect(adapter.query).toHaveBeenCalledTimes(1);

      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;

      expect(sql).toContain('INSERT INTO exports');
      expect(sql).toContain('(id, package_id, module_id, name, is_default)');
      expect(params).toEqual([dto.id, dto.package_id, dto.module_id, dto.name, dto.is_default]);
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('connection lost'));

      await expect(repo.create(makeExportDTO())).rejects.toThrow(RepositoryError);
      await expect(repo.create(makeExportDTO())).rejects.toThrow(/Failed to create export/);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should return the mapped entity when a row is found', async () => {
      const row = makeExportRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('export-1');

      expect(result).toEqual({
        id: 'export-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'MyExport',
        is_default: false,
      });

      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toContain('SELECT * FROM exports WHERE id = ?');
      expect(params).toEqual(['export-1']);
    });

    it('should return undefined when no rows are found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('disk error'));

      await expect(repo.retrieveById('export-1')).rejects.toThrow(RepositoryError);
      await expect(repo.retrieveById('export-1')).rejects.toThrow(/Failed to retrieve export by id/);
    });
  });

  // -----------------------------------------------------------------------
  // retrieve (generic)
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('should query all exports when no filters are provided', async () => {
      const rows = [makeExportRow({ id: 'e1', name: 'A' }), makeExportRow({ id: 'e2', name: 'B' })];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('A');
      expect(results[1]?.name).toBe('B');

      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toBe('SELECT * FROM exports');
      expect(params).toEqual([]);
    });

    it('should filter by id when id is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeExportRow()]);

      await repo.retrieve('export-1');

      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['export-1']);
    });

    it('should filter by module_id when module_id is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeExportRow()]);

      await repo.retrieve(undefined, 'mod-1');

      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });

    it('should prefer id filter over module_id when both are provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeExportRow()]);

      await repo.retrieve('export-1', 'mod-1');

      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toContain('WHERE id = ?');
      expect(params).toEqual(['export-1']);
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('timeout'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
      await expect(repo.retrieve()).rejects.toThrow(/Failed to retrieve exports/);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should delegate to retrieve with module_id', async () => {
      const rows = [makeExportRow({ id: 'e1' }), makeExportRow({ id: 'e2' })];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleId('mod-1');

      expect(results).toHaveLength(2);
      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toContain('WHERE module_id = ?');
      expect(params).toEqual(['mod-1']);
    });
  });

  // -----------------------------------------------------------------------
  // findByModuleId
  // -----------------------------------------------------------------------
  describe('findByModuleId', () => {
    it('should delegate to retrieveByModuleId', async () => {
      const rows = [makeExportRow({ id: 'e1' })];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.findByModuleId('mod-1');

      expect(results).toHaveLength(1);
      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql] = call as AdapterQueryCall;
      expect(sql).toContain('WHERE module_id = ?');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('should update the name field', async () => {
      // First call: the UPDATE query
      vi.mocked(adapter.query).mockResolvedValueOnce([]);
      // Second call: retrieveById after update
      const updatedRow = makeExportRow({ name: 'Renamed' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('export-1', { name: 'Renamed' });

      expect(result.name).toBe('Renamed');

      const updateCall = vi.mocked(adapter.query).mock.calls[0];
      expect(updateCall).toBeDefined();
      const [updateSql, updateParams] = updateCall as AdapterQueryCall;
      expect(updateSql).toContain('UPDATE exports SET');
      expect(updateSql).toContain('name = ?');
      expect(updateSql).toContain('WHERE id = ?');
      expect(updateParams).toEqual(['Renamed', 'export-1']);
    });

    it('should update the is_default field', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);
      const updatedRow = makeExportRow({ is_default: true });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('export-1', { is_default: true });

      expect(result.is_default).toBe(true);

      const updateCall = vi.mocked(adapter.query).mock.calls[0];
      expect(updateCall).toBeDefined();
      const [updateSql, updateParams] = updateCall as AdapterQueryCall;
      expect(updateSql).toContain('is_default = ?');
      expect(updateParams).toEqual([true, 'export-1']);
    });

    it('should update multiple fields at once', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);
      const updatedRow = makeExportRow({ name: 'NewName', is_default: true });
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('export-1', { name: 'NewName', is_default: true });

      expect(result.name).toBe('NewName');
      expect(result.is_default).toBe(true);

      const updateCall = vi.mocked(adapter.query).mock.calls[0];
      expect(updateCall).toBeDefined();
      const [updateSql] = updateCall as AdapterQueryCall;
      expect(updateSql).toContain('name = ?');
      expect(updateSql).toContain('is_default = ?');
    });

    it('should throw NoFieldsToUpdateError when DTO is empty', async () => {
      await expect(repo.update('export-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('should throw EntityNotFoundError when updated row is not found', async () => {
      // UPDATE succeeds
      vi.mocked(adapter.query).mockResolvedValueOnce([]);
      // retrieveById returns empty
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('export-1', { name: 'X' })).rejects.toThrow(EntityNotFoundError);
    });

    it('should wrap non-repository errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('write failed'));

      await expect(repo.update('export-1', { name: 'X' })).rejects.toThrow(RepositoryError);
      await expect(repo.update('export-1', { name: 'Y' })).rejects.toThrow(/write failed/);
    });

    it('should re-throw RepositoryError subclasses directly', async () => {
      const repoErr = new RepositoryError('custom', 'update', '[ExportRepository]');
      vi.mocked(adapter.query).mockRejectedValueOnce(repoErr);

      await expect(repo.update('export-1', { name: 'X' })).rejects.toBe(repoErr);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('should execute a DELETE query with the correct id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('export-1');

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;
      expect(sql).toContain('DELETE FROM exports WHERE id = ?');
      expect(params).toEqual(['export-1']);
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValue(new Error('locked'));

      await expect(repo.delete('export-1')).rejects.toThrow(RepositoryError);
      await expect(repo.delete('export-1')).rejects.toThrow(/Failed to delete export/);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('should do nothing for an empty array', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should insert multiple rows in a single query', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const items = [makeExportDTO({ id: 'e1', name: 'A' }), makeExportDTO({ id: 'e2', name: 'B' })];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const call = vi.mocked(adapter.query).mock.calls[0];
      expect(call).toBeDefined();
      const [sql, params] = call as AdapterQueryCall;

      expect(sql).toContain('INSERT INTO exports');
      expect(sql).toContain('(id, package_id, module_id, name, is_default)');
      // Two rows should produce two placeholder groups
      expect(sql).toContain('(?, ?, ?, ?, ?)');

      // 2 items x 5 columns = 10 params
      expect(params).toHaveLength(10);
      expect(params[0]).toBe('e1');
      expect(params[5]).toBe('e2');
    });

    it('should fall back to individual inserts on duplicate key errors', async () => {
      // First call (batch) rejects with UNIQUE error
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('UNIQUE constraint'));
      // Individual fallback inserts
      vi.mocked(adapter.query).mockResolvedValueOnce([]); // first item succeeds
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('UNIQUE constraint')); // second is dup, skipped

      const items = [makeExportDTO({ id: 'e1', name: 'A' }), makeExportDTO({ id: 'e2', name: 'B' })];

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual inserts = 3
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should throw non-duplicate errors from batch insert', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('disk full'));

      const items = [makeExportDTO({ id: 'e1' })];

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });

    it('should throw non-duplicate errors during individual fallback', async () => {
      // Batch fails with UNIQUE
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('UNIQUE constraint'));
      // Individual fallback fails with a non-duplicate error
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('disk full'));

      const items = [makeExportDTO({ id: 'e1' })];

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });
  });
});
