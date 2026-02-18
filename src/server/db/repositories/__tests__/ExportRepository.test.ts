import type { IDatabaseAdapter, DatabaseRow } from '../../adapter/IDatabaseAdapter';
import type { IExportCreateDTO } from '../ExportRepository';
import { ExportRepository } from '../ExportRepository';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../../errors/RepositoryError';

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------
function createMockAdapter(overrides: Partial<IDatabaseAdapter> = {}): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async <T>(cb: () => Promise<T>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
    ...overrides,
  };
}

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

function makeExportRow(partial: Partial<IExportCreateDTO> = {}): DatabaseRow & IExportCreateDTO & { created_at: string } {
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
    adapter = createMockAdapter();
    repo = new ExportRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('should insert a row and return the DTO', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const dto = makeExportDTO();
      const result = await repo.create(dto);

      expect(result).toEqual(dto);
      expect(adapter.query).toHaveBeenCalledTimes(1);

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql: string = call[0];
      const params: unknown[] = call[1];

      expect(sql).toContain('INSERT INTO exports');
      expect(sql).toContain('(id, package_id, module_id, name, is_default)');
      expect(params).toEqual([dto.id, dto.package_id, dto.module_id, dto.name, dto.is_default]);
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection lost'));

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
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('export-1');

      expect(result).toEqual({
        id: 'export-1',
        package_id: 'pkg-1',
        module_id: 'mod-1',
        name: 'MyExport',
        is_default: false,
      });

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('SELECT * FROM exports WHERE id = ?');
      expect(call[1]).toEqual(['export-1']);
    });

    it('should return undefined when no rows are found', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk error'));

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
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('A');
      expect(results[1]?.name).toBe('B');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('SELECT * FROM exports');
      expect(call[1]).toEqual([]);
    });

    it('should filter by id when id is provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeExportRow()]);

      await repo.retrieve('export-1');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('WHERE id = ?');
      expect(call[1]).toEqual(['export-1']);
    });

    it('should filter by module_id when module_id is provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeExportRow()]);

      await repo.retrieve(undefined, 'mod-1');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('WHERE module_id = ?');
      expect(call[1]).toEqual(['mod-1']);
    });

    it('should prefer id filter over module_id when both are provided', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeExportRow()]);

      await repo.retrieve('export-1', 'mod-1');

      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('WHERE id = ?');
      expect(call[1]).toEqual(['export-1']);
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

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
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleId('mod-1');

      expect(results).toHaveLength(2);
      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('WHERE module_id = ?');
      expect(call[1]).toEqual(['mod-1']);
    });
  });

  // -----------------------------------------------------------------------
  // findByModuleId
  // -----------------------------------------------------------------------
  describe('findByModuleId', () => {
    it('should delegate to retrieveByModuleId', async () => {
      const rows = [makeExportRow({ id: 'e1' })];
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const results = await repo.findByModuleId('mod-1');

      expect(results).toHaveLength(1);
      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('WHERE module_id = ?');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('should update the name field', async () => {
      // First call: the UPDATE query
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // Second call: retrieveById after update
      const updatedRow = makeExportRow({ name: 'Renamed' });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('export-1', { name: 'Renamed' });

      expect(result.name).toBe('Renamed');

      const updateCall = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE exports SET');
      expect(updateCall[0]).toContain('name = ?');
      expect(updateCall[0]).toContain('WHERE id = ?');
      expect(updateCall[1]).toEqual(['Renamed', 'export-1']);
    });

    it('should update the is_default field', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const updatedRow = makeExportRow({ is_default: true });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('export-1', { is_default: true });

      expect(result.is_default).toBe(true);

      const updateCall = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(updateCall[0]).toContain('is_default = ?');
      expect(updateCall[1]).toEqual([true, 'export-1']);
    });

    it('should update multiple fields at once', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const updatedRow = makeExportRow({ name: 'NewName', is_default: true });
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('export-1', { name: 'NewName', is_default: true });

      expect(result.name).toBe('NewName');
      expect(result.is_default).toBe(true);

      const updateCall = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(updateCall[0]).toContain('name = ?');
      expect(updateCall[0]).toContain('is_default = ?');
    });

    it('should throw NoFieldsToUpdateError when DTO is empty', async () => {
      await expect(repo.update('export-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('should throw EntityNotFoundError when updated row is not found', async () => {
      // UPDATE succeeds
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      // retrieveById returns empty
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(repo.update('export-1', { name: 'X' })).rejects.toThrow(EntityNotFoundError);
    });

    it('should wrap non-repository errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('write failed'));

      await expect(repo.update('export-1', { name: 'X' })).rejects.toThrow(RepositoryError);
      await expect(repo.update('export-1', { name: 'Y' })).rejects.toThrow(/write failed/);
    });

    it('should re-throw RepositoryError subclasses directly', async () => {
      const repoErr = new RepositoryError('custom', 'update', '[ExportRepository]');
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(repoErr);

      await expect(repo.update('export-1', { name: 'X' })).rejects.toBe(repoErr);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('should execute a DELETE query with the correct id', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await repo.delete('export-1');

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('DELETE FROM exports WHERE id = ?');
      expect(call[1]).toEqual(['export-1']);
    });

    it('should wrap adapter errors in RepositoryError', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('locked'));

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
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const items = [
        makeExportDTO({ id: 'e1', name: 'A' }),
        makeExportDTO({ id: 'e2', name: 'B' }),
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const call = (adapter.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql: string = call[0];

      expect(sql).toContain('INSERT INTO exports');
      expect(sql).toContain('(id, package_id, module_id, name, is_default)');
      // Two rows should produce two placeholder groups
      expect(sql).toContain('(?, ?, ?, ?, ?)');

      const params: unknown[] = call[1];
      // 2 items x 5 columns = 10 params
      expect(params).toHaveLength(10);
      expect(params[0]).toBe('e1');
      expect(params[5]).toBe('e2');
    });

    it('should fall back to individual inserts on duplicate key errors', async () => {
      // First call (batch) rejects with UNIQUE error
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('UNIQUE constraint'));
      // Individual fallback inserts
      (adapter.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // first item succeeds
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('UNIQUE constraint')); // second is dup, skipped

      const items = [
        makeExportDTO({ id: 'e1', name: 'A' }),
        makeExportDTO({ id: 'e2', name: 'B' }),
      ];

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual inserts = 3
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should throw non-duplicate errors from batch insert', async () => {
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

      const items = [makeExportDTO({ id: 'e1' })];

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });

    it('should throw non-duplicate errors during individual fallback', async () => {
      // Batch fails with UNIQUE
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('UNIQUE constraint'));
      // Individual fallback fails with a non-duplicate error
      (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

      const items = [makeExportDTO({ id: 'e1' })];

      await expect(repo.createBatch(items)).rejects.toThrow('disk full');
    });
  });
});
