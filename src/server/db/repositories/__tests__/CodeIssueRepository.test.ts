/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CodeIssueRepository } from '../CodeIssueRepository';
import { RepositoryError } from '../../errors/RepositoryError';

import type { ICodeIssueCreateDTO, ICodeIssueRow } from '../CodeIssueRepository';
import type { IDatabaseAdapter, QueryResult } from '../../adapter/IDatabaseAdapter';

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

function makeRow(overrides: Partial<ICodeIssueRow> = {}): ICodeIssueRow {
  return {
    id: 'issue-1',
    rule_code: 'no-any',
    severity: 'warning',
    message: 'Avoid using any',
    suggestion: null,
    package_id: 'pkg-1',
    module_id: 'mod-1',
    file_path: 'src/index.ts',
    entity_id: null,
    entity_type: null,
    entity_name: null,
    parent_entity_id: null,
    parent_entity_type: null,
    parent_entity_name: null,
    property_name: null,
    line: null,
    column: null,
    refactor_action: null,
    refactor_context_json: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCreateDTO(overrides: Partial<ICodeIssueCreateDTO> = {}): ICodeIssueCreateDTO {
  return {
    id: 'issue-1',
    rule_code: 'no-any',
    severity: 'warning',
    message: 'Avoid using any',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    file_path: 'src/index.ts',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodeIssueRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: CodeIssueRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new CodeIssueRepository(adapter);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('inserts a row and returns the mapped entity', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.create(makeCreateDTO());

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO code_issues');
      expect(sql).toContain('RETURNING *');
      expect(params).toContain('issue-1');
      expect(params).toContain('no-any');
      expect(params).toContain('warning');
      expect(params).toContain('Avoid using any');

      expect(result.id).toBe('issue-1');
      expect(result.rule_code).toBe('no-any');
      expect(result.severity).toBe('warning');
      expect(result.message).toBe('Avoid using any');
      expect(result.package_id).toBe('pkg-1');
      expect(result.module_id).toBe('mod-1');
      expect(result.file_path).toBe('src/index.ts');
    });

    it('maps nullable fields to undefined when null in the row', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.create(makeCreateDTO());

      expect(result.suggestion).toBeUndefined();
      expect(result.entity_id).toBeUndefined();
      expect(result.entity_type).toBeUndefined();
      expect(result.entity_name).toBeUndefined();
      expect(result.parent_entity_id).toBeUndefined();
      expect(result.parent_entity_type).toBeUndefined();
      expect(result.parent_entity_name).toBeUndefined();
      expect(result.property_name).toBeUndefined();
      expect(result.line).toBeUndefined();
      expect(result.column).toBeUndefined();
      expect(result.refactor_action).toBeUndefined();
      expect(result.refactor_context).toBeUndefined();
    });

    it('maps optional fields when present in the row', async () => {
      const row = makeRow({
        suggestion: 'Use unknown instead',
        entity_id: 'ent-1',
        entity_type: 'class',
        entity_name: 'MyClass',
        parent_entity_id: 'parent-1',
        parent_entity_type: 'module',
        parent_entity_name: 'myModule',
        property_name: 'myProp',
        line: 42,
        column: 10,
        refactor_action: 'replace',
        refactor_context_json: '{"target":"unknown"}',
      });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.create(makeCreateDTO());

      expect(result.suggestion).toBe('Use unknown instead');
      expect(result.entity_id).toBe('ent-1');
      expect(result.entity_type).toBe('class');
      expect(result.entity_name).toBe('MyClass');
      expect(result.parent_entity_id).toBe('parent-1');
      expect(result.parent_entity_type).toBe('module');
      expect(result.parent_entity_name).toBe('myModule');
      expect(result.property_name).toBe('myProp');
      expect(result.line).toBe(42);
      expect(result.column).toBe(10);
      expect(result.refactor_action).toBe('replace');
      expect(result.refactor_context).toEqual({ target: 'unknown' });
    });

    it('passes null for optional DTO fields that are undefined', async () => {
      const row = makeRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      await repo.create(makeCreateDTO());

      const params = vi.mocked(adapter.query).mock.calls[0]![1] as unknown[];
      // suggestion (index 4), entity_id (8), entity_type (9), entity_name (10),
      // parent_entity_id (11), parent_entity_type (12), parent_entity_name (13),
      // property_name (14), line (15), column (16), refactor_action (17),
      // refactor_context_json (18)
      const optionalIndices = [4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
      for (const idx of optionalIndices) {
        expect(params[idx]).toBeNull();
      }
    });

    it('throws when the query returns an empty result', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await expect(repo.create(makeCreateDTO())).rejects.toThrow('Failed to create code issue');
    });
  });

  // -----------------------------------------------------------------------
  // createBatch
  // -----------------------------------------------------------------------
  describe('createBatch', () => {
    it('does nothing when given an empty array', async () => {
      await repo.createBatch([]);

      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('inserts a batch of items in a single query', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      const items = [makeCreateDTO({ id: 'a' }), makeCreateDTO({ id: 'b' })];
      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('INSERT INTO code_issues');
      // Two rows, 19 columns each = 38 params
      expect(params).toHaveLength(38);
    });

    it('falls back to individual inserts on duplicate error', async () => {
      const items = [makeCreateDTO({ id: 'a' }), makeCreateDTO({ id: 'b' })];

      // First (batch) call: duplicate error
      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate entry'))
        // Individual inserts succeed
        .mockResolvedValueOnce([] as QueryResult)
        .mockResolvedValueOnce([] as QueryResult);

      await repo.createBatch(items);

      // 1 batch + 2 individual
      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('skips individual duplicates during fallback', async () => {
      const items = [makeCreateDTO({ id: 'a' }), makeCreateDTO({ id: 'b' })];

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('UNIQUE constraint'))
        // First individual insert: duplicate
        .mockRejectedValueOnce(new Error('already exists'))
        // Second individual insert: success
        .mockResolvedValueOnce([] as QueryResult);

      await repo.createBatch(items);

      expect(adapter.query).toHaveBeenCalledTimes(3);
    });

    it('rethrows non-duplicate errors from batch insert', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Connection lost'));

      await expect(
        repo.createBatch([makeCreateDTO()])
      ).rejects.toThrow('Connection lost');
    });

    it('rethrows non-duplicate errors from individual fallback inserts', async () => {
      const items = [makeCreateDTO({ id: 'a' }), makeCreateDTO({ id: 'b' })];

      vi.mocked(adapter.query)
        .mockRejectedValueOnce(new Error('Duplicate entry'))
        .mockRejectedValueOnce(new Error('Disk full'));

      await expect(repo.createBatch(items)).rejects.toThrow('Disk full');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('throws "Not supported" error', () => {
      expect(() => repo.update('id', {} as Record<string, never>)).toThrow(
        'Not supported for CodeIssueRepository'
      );
    });
  });

  // -----------------------------------------------------------------------
  // retrieveById
  // -----------------------------------------------------------------------
  describe('retrieveById', () => {
    it('returns the mapped entity when a row is found', async () => {
      const row = makeRow({ id: 'issue-42' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById('issue-42');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM code_issues WHERE id = ?');
      expect(params).toEqual(['issue-42']);
      expect(result).toBeDefined();
      expect(result!.id).toBe('issue-42');
    });

    it('returns undefined when no row is found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // retrieveByModuleId
  // -----------------------------------------------------------------------
  describe('retrieveByModuleId', () => {
    it('returns an array of entities for the given module', async () => {
      const rows = [
        makeRow({ id: 'issue-1', module_id: 'mod-5' }),
        makeRow({ id: 'issue-2', module_id: 'mod-5' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows as QueryResult);

      const results = await repo.retrieveByModuleId('mod-5');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM code_issues WHERE module_id = ?');
      expect(params).toEqual(['mod-5']);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe('issue-1');
      expect(results[1]!.id).toBe('issue-2');
    });

    it('returns an empty array when no rows match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      const results = await repo.retrieveByModuleId('mod-empty');

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // retrieve (all)
  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('returns all entities ordered by rule_code and file_path', async () => {
      const rows = [
        makeRow({ id: 'a', rule_code: 'import-order', file_path: 'a.ts' }),
        makeRow({ id: 'b', rule_code: 'no-any', file_path: 'b.ts' }),
      ];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows as QueryResult);

      const results = await repo.retrieve();

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('SELECT * FROM code_issues ORDER BY rule_code, file_path');
      expect(results).toHaveLength(2);
    });

    it('returns an empty array when the table is empty', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      const results = await repo.retrieve();

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete', () => {
    it('executes a DELETE query with the correct id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.delete('issue-99');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('DELETE FROM code_issues WHERE id = ?');
      expect(params).toEqual(['issue-99']);
    });
  });

  // -----------------------------------------------------------------------
  // deleteByPackageId
  // -----------------------------------------------------------------------
  describe('deleteByPackageId', () => {
    it('executes a DELETE query with the correct package_id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([] as QueryResult);

      await repo.deleteByPackageId('pkg-7');

      expect(adapter.query).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(adapter.query).mock.calls[0]!;
      expect(sql).toContain('DELETE FROM code_issues WHERE package_id = ?');
      expect(params).toEqual(['pkg-7']);
    });
  });

  // -----------------------------------------------------------------------
  // mapToEntity (tested indirectly via create/retrieve)
  // -----------------------------------------------------------------------
  describe('mapToEntity edge cases', () => {
    it('parses valid refactor_context_json into an object', async () => {
      const json = JSON.stringify({ action: 'rename', from: 'foo', to: 'bar' });
      const row = makeRow({ refactor_context_json: json, refactor_action: 'rename' });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById('issue-1');

      expect(result!.refactor_context).toEqual({ action: 'rename', from: 'foo', to: 'bar' });
    });

    it('leaves refactor_context undefined when JSON is invalid', async () => {
      const row = makeRow({
        refactor_context_json: '{not valid json',
        refactor_action: 'rename',
      });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById('issue-1');

      expect(result!.refactor_action).toBe('rename');
      expect(result!.refactor_context).toBeUndefined();
    });

    it('leaves refactor_context undefined when refactor_context_json is null', async () => {
      const row = makeRow({ refactor_context_json: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById('issue-1');

      expect(result!.refactor_context).toBeUndefined();
    });

    it('includes line and column as numbers when present', async () => {
      const row = makeRow({ line: 100, column: 25 });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById('issue-1');

      expect(result!.line).toBe(100);
      expect(result!.column).toBe(25);
    });

    it('omits line and column when they are null', async () => {
      const row = makeRow({ line: null, column: null });
      vi.mocked(adapter.query).mockResolvedValueOnce([row] as QueryResult);

      const result = await repo.retrieveById('issue-1');

      expect(result!).not.toHaveProperty('line');
      expect(result!).not.toHaveProperty('column');
    });
  });

  // -----------------------------------------------------------------------
  // Error handling via BaseRepository.executeQuery
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('wraps adapter errors in a RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(repo.retrieveById('id')).rejects.toThrow(RepositoryError);
    });

    it('preserves the original error message in the wrapped RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Connection refused'));

      try {
        await repo.retrieveById('id');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryError);
        const repoError = error as RepositoryError;
        expect(repoError.message).toContain('Connection refused');
      }
    });

    it('includes operation context in the error for prepared statement errors', async () => {
      vi.mocked(adapter.query).mockRejectedValue(
        new Error('prepared statement already exists')
      );

      try {
        await repo.retrieve();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryError);
        const repoError = error as RepositoryError;
        expect(repoError.message).toContain('prepared statement');
        expect(repoError.message).toContain('code_issues');
      }
    });

    it('rethrows RepositoryError instances without wrapping', async () => {
      const original = new RepositoryError('original', 'op', 'tag');
      vi.mocked(adapter.query).mockRejectedValueOnce(original);

      try {
        await repo.retrieve();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBe(original);
      }
    });

    it('wraps non-Error throwables into RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce('string error');

      await expect(repo.retrieveById('id')).rejects.toThrow(RepositoryError);
    });
  });
});
