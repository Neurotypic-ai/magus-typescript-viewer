import { vi } from 'vitest';

import { Enum } from '../../../../shared/types/Enum';
import { RepositoryError } from '../../errors/RepositoryError';
import { EnumRepository } from '../EnumRepository';

import type { IEnumCreateDTO, IEnumRow } from '../EnumRepository';
import type { IDatabaseAdapter } from '../../adapter/IDatabaseAdapter';

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

const NOW_ISO = '2025-01-15T12:00:00.000Z';

function makeRow(overrides: Partial<IEnumRow> = {}): IEnumRow {
  return {
    id: 'enum-id-1',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'Status',
    members_json: JSON.stringify(['Active', 'Inactive']),
    created_at: NOW_ISO,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnumRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: EnumRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new EnumRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('should insert a row and return the mapped Enum entity', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const dto: IEnumCreateDTO = {
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
        members_json: row.members_json ?? undefined,
      };

      const result = await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO enums'),
        [dto.id, dto.package_id, dto.module_id, dto.name, dto.members_json ?? null]
      );
      expect(result).toBeInstanceOf(Enum);
      expect(result.id).toBe(row.id);
      expect(result.name).toBe('Status');
      expect(result.members).toEqual(['Active', 'Inactive']);
    });

    it('should pass null for members_json when not provided', async () => {
      const row = makeRow({ members_json: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const dto: IEnumCreateDTO = {
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
      };

      await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO enums'),
        [dto.id, dto.package_id, dto.module_id, dto.name, null]
      );
    });

    it('should throw RepositoryError when INSERT returns no rows', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const dto: IEnumCreateDTO = {
        id: 'id',
        package_id: 'pkg',
        module_id: 'mod',
        name: 'Empty',
      };

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('should insert multiple rows in a single batch query', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const items: IEnumCreateDTO[] = [
        { id: 'e1', package_id: 'p1', module_id: 'm1', name: 'A', members_json: '["X"]' },
        { id: 'e2', package_id: 'p1', module_id: 'm1', name: 'B' },
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      const call = vi.mocked(adapter.query).mock.calls[0];
      // Should contain two value groups
      expect(call?.[0]).toContain('(?, ?, ?, ?, ?), (?, ?, ?, ?, ?)');
      // Params: 5 per item = 10 total
      expect(call?.[1]).toHaveLength(10);
      // Second item's members_json should be null (not provided)
      expect(call?.[1]?.[9]).toBeNull();
    });

    it('should be a no-op for an empty array', async () => {
      await repo.createBatch([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('should fall back to individual inserts on duplicate key errors', async () => {
      const items: IEnumCreateDTO[] = [
        { id: 'e1', package_id: 'p1', module_id: 'm1', name: 'A' },
        { id: 'e2', package_id: 'p1', module_id: 'm1', name: 'B' },
      ];

      // First call (batch) fails with duplicate error
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        // Individual fallback for item 1 — succeeds
        .mockResolvedValueOnce([])
        // Individual fallback for item 2 — succeeds
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      // 1 batch attempt + 2 individual inserts
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should skip individual duplicate inserts during fallback', async () => {
      const items: IEnumCreateDTO[] = [
        { id: 'e1', package_id: 'p1', module_id: 'm1', name: 'A' },
        { id: 'e2', package_id: 'p1', module_id: 'm1', name: 'B' },
      ];

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        // First individual insert fails with duplicate
        .mockRejectedValueOnce(new Error('Duplicate'))
        // Second individual insert succeeds
        .mockResolvedValueOnce([]);

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('should rethrow non-duplicate errors from batch insert', async () => {
      const items: IEnumCreateDTO[] = [
        { id: 'e1', package_id: 'p1', module_id: 'm1', name: 'A' },
      ];

      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Connection lost'));

      await expect(repo.createBatch(items)).rejects.toThrow('Connection lost');
    });

    it('should rethrow non-duplicate errors from individual fallback inserts', async () => {
      const items: IEnumCreateDTO[] = [
        { id: 'e1', package_id: 'p1', module_id: 'm1', name: 'A' },
      ];

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('already exists'))
        .mockRejectedValueOnce(new Error('Connection lost'));

      await expect(repo.createBatch(items)).rejects.toThrow('Connection lost');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('should update the name field', async () => {
      const updated = makeRow({ name: 'UpdatedStatus' });
      vi.mocked(adapter.query).mockResolvedValueOnce([updated]);

      const result = await repo.update('enum-id-1', { name: 'UpdatedStatus' });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE enums SET name = ?'),
        ['UpdatedStatus', 'enum-id-1']
      );
      expect(result.name).toBe('UpdatedStatus');
    });

    it('should update the members_json field', async () => {
      const newMembers = JSON.stringify(['A', 'B', 'C']);
      const updated = makeRow({ members_json: newMembers });
      vi.mocked(adapter.query).mockResolvedValueOnce([updated]);

      const result = await repo.update('enum-id-1', { members_json: newMembers });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('members_json = ?'),
        [newMembers, 'enum-id-1']
      );
      expect(result.members).toEqual(['A', 'B', 'C']);
    });

    it('should update both fields at once', async () => {
      const newMembers = JSON.stringify(['X']);
      const updated = makeRow({ name: 'NewName', members_json: newMembers });
      vi.mocked(adapter.query).mockResolvedValueOnce([updated]);

      const result = await repo.update('enum-id-1', { name: 'NewName', members_json: newMembers });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('name = ?, members_json = ?'),
        ['NewName', newMembers, 'enum-id-1']
      );
      expect(result.name).toBe('NewName');
      expect(result.members).toEqual(['X']);
    });

    it('should return existing entity when update DTO is empty', async () => {
      const existing = makeRow();
      // First call for retrieveById inside update
      vi.mocked(adapter.query).mockResolvedValueOnce([existing]);

      const result = await repo.update('enum-id-1', {});

      expect(result).toBeInstanceOf(Enum);
      expect(result.id).toBe('enum-id-1');
    });

    it('should throw RepositoryError when empty DTO and entity not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('missing-id', {})).rejects.toThrow(RepositoryError);
    });

    it('should throw RepositoryError when UPDATE returns no rows', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('missing-id', { name: 'X' })).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('should return the mapped Enum when found', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('enum-id-1');

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM enums WHERE id = ?'),
        ['enum-id-1']
      );
      expect(result).toBeInstanceOf(Enum);
      expect(result?.id).toBe('enum-id-1');
    });

    it('should return undefined when not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('should return all enums for a given module', async () => {
      const rows = [
        makeRow({ id: 'e1', name: 'Alpha' }),
        makeRow({ id: 'e2', name: 'Beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleId('mod-1');

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE module_id = ?'),
        ['mod-1']
      );
      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(Enum);
      expect(results[1]).toBeInstanceOf(Enum);
    });

    it('should return an empty array when no enums exist for the module', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieveByModuleId('empty-mod');

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleIds
  // -----------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('should return enums across multiple modules', async () => {
      const rows = [
        makeRow({ id: 'e1', module_id: 'mod-1', name: 'A' }),
        makeRow({ id: 'e2', module_id: 'mod-2', name: 'B' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleIds(['mod-1', 'mod-2']);

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE module_id IN (?, ?)'),
        ['mod-1', 'mod-2']
      );
      expect(results).toHaveLength(2);
    });

    it('should return an empty array for empty input', async () => {
      const results = await repo.retrieveByModuleIds([]);

      expect(results).toEqual([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // retrieve (all)
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('should return all enums ordered by name', async () => {
      const rows = [
        makeRow({ id: 'e1', name: 'Alpha' }),
        makeRow({ id: 'e2', name: 'Beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM enums ORDER BY name'),
        []
      );
      expect(results).toHaveLength(2);
      expect(results.every((e) => e instanceof Enum)).toBe(true);
    });

    it('should return an empty array when table is empty', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieve();

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('should execute DELETE query with the correct id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('enum-id-1');

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM enums WHERE id = ?'),
        ['enum-id-1']
      );
    });
  });

  // -----------------------------------------------------------------------
  // mapToEntity (tested indirectly through public methods)
  // -----------------------------------------------------------------------
  describe('mapToEntity (via create)', () => {
    it('should parse valid members_json into members array', async () => {
      const row = makeRow({ members_json: '["Red", "Green", "Blue"]' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create({
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
        members_json: row.members_json ?? undefined,
      });

      expect(result.members).toEqual(['Red', 'Green', 'Blue']);
    });

    it('should return empty members for null members_json', async () => {
      const row = makeRow({ members_json: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create({
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
      });

      expect(result.members).toEqual([]);
    });

    it('should return empty members for invalid JSON in members_json', async () => {
      const row = makeRow({ members_json: '{not valid json' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create({
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
        members_json: '{not valid json',
      });

      expect(result.members).toEqual([]);
    });

    it('should filter out non-string members from members_json', async () => {
      const row = makeRow({ members_json: '["Valid", 42, null, "AlsoValid"]' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create({
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
        members_json: row.members_json ?? undefined,
      });

      expect(result.members).toEqual(['Valid', 'AlsoValid']);
    });

    it('should return empty members when members_json is a non-array JSON value', async () => {
      const row = makeRow({ members_json: '{"key": "value"}' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create({
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
        members_json: row.members_json ?? undefined,
      });

      expect(result.members).toEqual([]);
    });

    it('should correctly parse the created_at date', async () => {
      const row = makeRow({ created_at: '2025-06-01T08:30:00.000Z' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create({
        id: row.id,
        package_id: row.package_id,
        module_id: row.module_id,
        name: row.name,
      });

      expect(result.created_at).toBeInstanceOf(Date);
      expect(result.created_at.toISOString()).toBe('2025-06-01T08:30:00.000Z');
    });
  });

  // -----------------------------------------------------------------------
  // Error propagation from adapter
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('should wrap adapter errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('connection refused'));

      await expect(repo.retrieveById('any')).rejects.toThrow(RepositoryError);
    });

    it('should preserve RepositoryError when adapter throws one', async () => {
      const original = new RepositoryError('custom error', 'test', '[Test]');
      vi.mocked(adapter.query).mockRejectedValueOnce(original);

      await expect(repo.retrieveById('any')).rejects.toThrow(original);
    });

    it('should include query details for prepared statement errors', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(
        new Error('prepared statement error: invalid syntax')
      );

      await expect(repo.retrieve()).rejects.toThrow(/prepared statement/);
    });
  });
});
