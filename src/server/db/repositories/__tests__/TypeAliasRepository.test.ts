// @vitest-environment node
import { vi } from 'vitest';

import { TypeAlias } from '../../../../shared/types/TypeAlias';
import { RepositoryError } from '../../errors/RepositoryError';
import { TypeAliasRepository } from '../TypeAliasRepository';

import type { ITypeAliasCreateDTO, ITypeAliasRow } from '../TypeAliasRepository';
import type { IDatabaseAdapter, QueryResult } from '../../adapter/IDatabaseAdapter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    query: vi.fn<() => Promise<QueryResult>>().mockResolvedValue([]),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    transaction: vi.fn<() => Promise<unknown>>(),
    getDbPath: vi.fn<() => string>().mockReturnValue(':memory:'),
  };
}

function makeRow(overrides: Partial<ITypeAliasRow> = {}): ITypeAliasRow {
  return {
    id: 'ta-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    name: 'MyType',
    type: 'string | number',
    type_parameters_json: null,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCreateDTO(overrides: Partial<ITypeAliasCreateDTO> = {}): ITypeAliasCreateDTO {
  return {
    id: 'ta-uuid-1',
    package_id: 'pkg-uuid-1',
    module_id: 'mod-uuid-1',
    name: 'MyType',
    type: 'string | number',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TypeAliasRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: TypeAliasRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new TypeAliasRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('inserts a row and returns a TypeAlias entity', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create(makeCreateDTO());

      expect(result).toBeInstanceOf(TypeAlias);
      expect(result.id).toBe('ta-uuid-1');
      expect(result.package_id).toBe('pkg-uuid-1');
      expect(result.module_id).toBe('mod-uuid-1');
      expect(result.name).toBe('MyType');
      expect(result.type).toBe('string | number');
      expect(result.typeParameters).toEqual([]);
      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('passes the correct SQL and parameters to the adapter', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      await repo.create(makeCreateDTO());

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO type_aliases'),
        ['ta-uuid-1', 'pkg-uuid-1', 'mod-uuid-1', 'MyType', 'string | number', null]
      );
    });

    it('passes type_parameters_json when provided', async () => {
      const row = makeRow({ type_parameters_json: '["T","U"]' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const dto = makeCreateDTO({ type_parameters_json: '["T","U"]' });
      const result = await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO type_aliases'),
        ['ta-uuid-1', 'pkg-uuid-1', 'mod-uuid-1', 'MyType', 'string | number', '["T","U"]']
      );
      expect(result.typeParameters).toEqual(['T', 'U']);
    });

    it('throws RepositoryError when the insert returns no row', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(RepositoryError);
    });

    it('throws RepositoryError when the adapter rejects', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('DB error'));

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('performs a batch insert for multiple items', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const items: ITypeAliasCreateDTO[] = [
        makeCreateDTO({ id: 'ta-1', name: 'TypeA' }),
        makeCreateDTO({ id: 'ta-2', name: 'TypeB' }),
      ];

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(1);
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO type_aliases'),
        expect.arrayContaining(['ta-1', 'ta-2', 'TypeA', 'TypeB'])
      );
    });

    it('does nothing when given an empty array', async () => {
      await repo.createBatch([]);

      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('falls back to individual inserts on duplicate key errors', async () => {
      // First bulk call fails with duplicate
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        .mockResolvedValueOnce([])   // individual insert #1
        .mockResolvedValueOnce([]);  // individual insert #2

      const items: ITypeAliasCreateDTO[] = [
        makeCreateDTO({ id: 'ta-1', name: 'TypeA' }),
        makeCreateDTO({ id: 'ta-2', name: 'TypeB' }),
      ];

      await repo.createBatch(items);

      // 1 bulk + 2 individual = 3
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('silently skips individual duplicate inserts during fallback', async () => {
      // Bulk fails with duplicate
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate entry'))
        .mockRejectedValueOnce(new Error('Duplicate entry'))  // individual #1 also duplicate
        .mockResolvedValueOnce([]);  // individual #2 succeeds

      const items: ITypeAliasCreateDTO[] = [
        makeCreateDTO({ id: 'ta-1', name: 'TypeA' }),
        makeCreateDTO({ id: 'ta-2', name: 'TypeB' }),
      ];

      // Should not throw
      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('rethrows non-duplicate errors from individual inserts', async () => {
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
        .mockRejectedValueOnce(new Error('Connection lost'));

      const items: ITypeAliasCreateDTO[] = [
        makeCreateDTO({ id: 'ta-1', name: 'TypeA' }),
        makeCreateDTO({ id: 'ta-2', name: 'TypeB' }),
      ];

      await expect(repo.createBatch(items)).rejects.toThrow('Connection lost');
    });

    it('rethrows non-duplicate errors from bulk insert', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Connection lost'));

      const items: ITypeAliasCreateDTO[] = [
        makeCreateDTO({ id: 'ta-1', name: 'TypeA' }),
      ];

      await expect(repo.createBatch(items)).rejects.toThrow('Connection lost');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('updates name and returns the updated entity', async () => {
      const row = makeRow({ name: 'RenamedType' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.update('ta-uuid-1', { name: 'RenamedType' });

      expect(result).toBeInstanceOf(TypeAlias);
      expect(result.name).toBe('RenamedType');

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE type_aliases SET name = ?'),
        ['RenamedType', 'ta-uuid-1']
      );
    });

    it('updates type and returns the updated entity', async () => {
      const row = makeRow({ type: 'boolean' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.update('ta-uuid-1', { type: 'boolean' });

      expect(result.type).toBe('boolean');
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE type_aliases SET type = ?'),
        ['boolean', 'ta-uuid-1']
      );
    });

    it('updates type_parameters_json', async () => {
      const row = makeRow({ type_parameters_json: '["K","V"]' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.update('ta-uuid-1', { type_parameters_json: '["K","V"]' });

      expect(result.typeParameters).toEqual(['K', 'V']);
    });

    it('builds SET clause for multiple fields', async () => {
      const row = makeRow({ name: 'NewName', type: 'number' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      await repo.update('ta-uuid-1', { name: 'NewName', type: 'number' });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('name = ?'),
        expect.arrayContaining(['NewName', 'number', 'ta-uuid-1'])
      );
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('type = ?'),
        expect.arrayContaining(['NewName', 'number', 'ta-uuid-1'])
      );
    });

    it('returns existing entity when DTO has no fields', async () => {
      const row = makeRow();
      // The update with empty DTO calls retrieveById, which uses a SELECT query
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.update('ta-uuid-1', {});

      expect(result).toBeInstanceOf(TypeAlias);
      expect(result.id).toBe('ta-uuid-1');
      // Should have called SELECT (retrieveById), not UPDATE
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM type_aliases WHERE id = ?'),
        ['ta-uuid-1']
      );
    });

    it('throws RepositoryError when empty DTO and entity not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('missing-id', {})).rejects.toThrow(RepositoryError);
    });

    it('throws RepositoryError when UPDATE returns no row', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('missing-id', { name: 'NewName' })).rejects.toThrow(RepositoryError);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('returns a TypeAlias entity when found', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result).toBeInstanceOf(TypeAlias);
      expect(result?.id).toBe('ta-uuid-1');
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM type_aliases WHERE id = ?'),
        ['ta-uuid-1']
      );
    });

    it('returns undefined when not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('returns an array of TypeAlias entities', async () => {
      const rows = [
        makeRow({ id: 'ta-1', name: 'Alpha' }),
        makeRow({ id: 'ta-2', name: 'Beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleId('mod-uuid-1');

      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(TypeAlias);
      expect(results[0]?.name).toBe('Alpha');
      expect(results[1]?.name).toBe('Beta');
    });

    it('passes module_id to the query', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.retrieveByModuleId('mod-uuid-1');

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE module_id = ?'),
        ['mod-uuid-1']
      );
    });

    it('returns an empty array when no rows match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieveByModuleId('mod-uuid-1');

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleIds
  // -----------------------------------------------------------------------
  describe('retrieveByModuleIds', () => {
    it('returns type aliases for multiple module IDs', async () => {
      const rows = [
        makeRow({ id: 'ta-1', module_id: 'mod-1' }),
        makeRow({ id: 'ta-2', module_id: 'mod-2' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleIds(['mod-1', 'mod-2']);

      expect(results).toHaveLength(2);
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE module_id IN (?, ?)'),
        ['mod-1', 'mod-2']
      );
    });

    it('returns an empty array immediately for empty input', async () => {
      const results = await repo.retrieveByModuleIds([]);

      expect(results).toEqual([]);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('builds correct placeholders for a single ID', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([makeRow()]);

      await repo.retrieveByModuleIds(['mod-1']);

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE module_id IN (?)'),
        ['mod-1']
      );
    });
  });

  // -----------------------------------------------------------------------
  // retrieve (all)
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('returns all type aliases ordered by name', async () => {
      const rows = [
        makeRow({ id: 'ta-1', name: 'Alpha' }),
        makeRow({ id: 'ta-2', name: 'Beta' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(TypeAlias);
      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM type_aliases ORDER BY name'),
        expect.anything()
      );
    });

    it('returns an empty array when no type aliases exist', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieve();

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('executes a DELETE query with the correct id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('ta-uuid-1');

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM type_aliases WHERE id = ?'),
        ['ta-uuid-1']
      );
    });
  });

  // -----------------------------------------------------------------------
  // mapToEntity (tested through public methods)
  // -----------------------------------------------------------------------
  describe('mapToEntity behavior', () => {
    it('parses type_parameters_json into an array of strings', async () => {
      const row = makeRow({ type_parameters_json: '["T","U","V"]' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result?.typeParameters).toEqual(['T', 'U', 'V']);
    });

    it('returns empty array when type_parameters_json is null', async () => {
      const row = makeRow({ type_parameters_json: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result?.typeParameters).toEqual([]);
    });

    it('returns empty array for invalid JSON in type_parameters_json', async () => {
      const row = makeRow({ type_parameters_json: 'not-json' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result?.typeParameters).toEqual([]);
    });

    it('filters out non-string values from type_parameters_json', async () => {
      const row = makeRow({ type_parameters_json: '["T", 42, null, "U", true]' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result?.typeParameters).toEqual(['T', 'U']);
    });

    it('returns empty array when type_parameters_json is a non-array JSON value', async () => {
      const row = makeRow({ type_parameters_json: '{"key": "value"}' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result?.typeParameters).toEqual([]);
    });

    it('converts created_at string to a Date object', async () => {
      const row = makeRow({ created_at: '2025-06-15T12:30:00.000Z' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('ta-uuid-1');

      expect(result?.created_at).toBeInstanceOf(Date);
      expect(result?.created_at.toISOString()).toBe('2025-06-15T12:30:00.000Z');
    });
  });
});
