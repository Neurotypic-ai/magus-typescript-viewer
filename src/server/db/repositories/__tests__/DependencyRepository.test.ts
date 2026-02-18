// @vitest-environment node
import { vi } from 'vitest';

import { DependencyRepository } from '../DependencyRepository';
import { RepositoryError } from '../../errors/RepositoryError';

import type { IDatabaseAdapter, QueryResult, DatabaseRow } from '../../adapter/IDatabaseAdapter';
import type { IDependencyCreateDTO, IDependencyUpdateDTO } from '../../types/Dependency';

function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    query: vi.fn<() => Promise<QueryResult>>().mockResolvedValue([]),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    transaction: vi.fn<(cb: () => Promise<unknown>) => Promise<unknown>>().mockImplementation(async (cb) => cb()),
    getDbPath: vi.fn<() => string>().mockReturnValue(':memory:'),
  };
}

function makeDependencyRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
  return {
    id: 'source-1_target-1',
    source_id: 'source-1',
    target_id: 'target-1',
    type: 'dependency',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DependencyRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: DependencyRepository;

  beforeEach(() => {
    adapter = createMockAdapter();
    repo = new DependencyRepository(adapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('initializes with the correct table name and error tag', () => {
      // The repository should be usable after construction
      expect(repo).toBeInstanceOf(DependencyRepository);
    });
  });

  describe('create', () => {
    it('inserts a valid dependency and returns the entity', async () => {
      const dto: IDependencyCreateDTO = {
        source_id: 'pkg-a',
        target_id: 'pkg-b',
        type: 'dependency',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.create(dto);

      expect(result.id).toBe('pkg-a_pkg-b');
      expect(result.source_id).toBe('pkg-a');
      expect(result.target_id).toBe('pkg-b');
      expect(result.type).toBe('dependency');
      expect(result.created_at).toBeInstanceOf(Date);

      expect(adapter.query).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(callArgs[0]).toContain('INSERT INTO dependencies');
      const params = callArgs[1];
      expect(params).toHaveLength(5);
      expect(params[0]).toBe('pkg-a_pkg-b');
      expect(params[1]).toBe('pkg-a');
      expect(params[2]).toBe('pkg-b');
      expect(params[3]).toBe('dependency');
    });

    it('generates a deterministic id from source_id and target_id', async () => {
      const dto: IDependencyCreateDTO = {
        source_id: 'abc',
        target_id: 'xyz',
        type: 'devDependency',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.create(dto);
      expect(result.id).toBe('abc_xyz');
    });

    it('accepts devDependency type', async () => {
      const dto: IDependencyCreateDTO = {
        source_id: 'pkg-a',
        target_id: 'pkg-b',
        type: 'devDependency',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.create(dto);
      expect(result.type).toBe('devDependency');
    });

    it('accepts peerDependency type', async () => {
      const dto: IDependencyCreateDTO = {
        source_id: 'pkg-a',
        target_id: 'pkg-b',
        type: 'peerDependency',
      };

      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.create(dto);
      expect(result.type).toBe('peerDependency');
    });

    it('throws RepositoryError for invalid DTO (missing source_id)', async () => {
      const dto = {
        target_id: 'pkg-b',
        type: 'dependency',
      } as unknown as IDependencyCreateDTO;

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('throws RepositoryError for invalid DTO (missing target_id)', async () => {
      const dto = {
        source_id: 'pkg-a',
        type: 'dependency',
      } as unknown as IDependencyCreateDTO;

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('throws RepositoryError for invalid DTO (invalid type)', async () => {
      const dto = {
        source_id: 'pkg-a',
        target_id: 'pkg-b',
        type: 'optionalDependency',
      } as unknown as IDependencyCreateDTO;

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('throws RepositoryError for null DTO', async () => {
      await expect(repo.create(null as unknown as IDependencyCreateDTO)).rejects.toThrow(RepositoryError);
    });

    it('throws RepositoryError when the database query fails', async () => {
      const dto: IDependencyCreateDTO = {
        source_id: 'pkg-a',
        target_id: 'pkg-b',
        type: 'dependency',
      };

      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
    });

    it('wraps foreign key constraint errors in RepositoryError without logging', async () => {
      const dto: IDependencyCreateDTO = {
        source_id: 'pkg-a',
        target_id: 'pkg-b',
        type: 'dependency',
      };

      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('foreign key constraint violation'));

      await expect(repo.create(dto)).rejects.toThrow(RepositoryError);
    });
  });

  describe('update', () => {
    it('updates the type field and returns the updated entity', async () => {
      const dto: IDependencyUpdateDTO = { type: 'devDependency' };
      const updatedRow = makeDependencyRow({ type: 'devDependency' });

      // First call: the UPDATE query
      vi.mocked(adapter.query).mockResolvedValueOnce([]);
      // Second call: the retrieve query following the update
      vi.mocked(adapter.query).mockResolvedValueOnce([updatedRow]);

      const result = await repo.update('source-1_target-1', dto);

      expect(result.id).toBe('source-1_target-1');
      expect(result.type).toBe('devDependency');
      expect(adapter.query).toHaveBeenCalledTimes(2);

      const updateCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE dependencies SET');
      expect(updateCall[0]).toContain('type = ?');
    });

    it('throws NoFieldsToUpdateError when dto has no fields set', async () => {
      const dto: IDependencyUpdateDTO = {};

      await expect(repo.update('some-id', dto)).rejects.toThrow(RepositoryError);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('throws NoFieldsToUpdateError when type is undefined', async () => {
      const dto: IDependencyUpdateDTO = { type: undefined };

      await expect(repo.update('some-id', dto)).rejects.toThrow(RepositoryError);
      expect(adapter.query).not.toHaveBeenCalled();
    });

    it('throws EntityNotFoundError when the entity does not exist after update', async () => {
      const dto: IDependencyUpdateDTO = { type: 'peerDependency' };

      // UPDATE succeeds
      vi.mocked(adapter.query).mockResolvedValueOnce([]);
      // retrieve returns empty (entity not found)
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.update('nonexistent-id', dto)).rejects.toThrow(RepositoryError);
    });

    it('throws RepositoryError when the UPDATE query fails', async () => {
      const dto: IDependencyUpdateDTO = { type: 'devDependency' };

      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('DB write error'));

      await expect(repo.update('some-id', dto)).rejects.toThrow(RepositoryError);
    });

    it('re-throws existing RepositoryError without wrapping', async () => {
      const dto: IDependencyUpdateDTO = { type: 'devDependency' };
      const repoError = new RepositoryError('Custom error', 'update', '[DependencyRepository]');

      vi.mocked(adapter.query).mockRejectedValueOnce(repoError);

      await expect(repo.update('some-id', dto)).rejects.toThrow(repoError);
    });
  });

  describe('retrieve', () => {
    it('returns all dependencies when called without arguments', async () => {
      const rows = [
        makeDependencyRow(),
        makeDependencyRow({ id: 'source-2_target-2', source_id: 'source-2', target_id: 'target-2' }),
      ];

      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('source-1_target-1');
      expect(results[1].id).toBe('source-2_target-2');

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toBe('SELECT * FROM dependencies');
      expect(queryCall[1]).toEqual([]);
    });

    it('filters by id when id argument is provided', async () => {
      const rows = [makeDependencyRow()];
      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieve('source-1_target-1');

      expect(results).toHaveLength(1);

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('WHERE');
      expect(queryCall[0]).toContain('id = ?');
      expect(queryCall[1]).toContain('source-1_target-1');
    });

    it('filters by module_id when module_id argument is provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.retrieve(undefined, 'mod-1');

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('WHERE');
      expect(queryCall[0]).toContain('module_id = ?');
      expect(queryCall[1]).toContain('mod-1');
    });

    it('filters by both id and module_id when both are provided', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.retrieve('some-id', 'mod-1');

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('id = ?');
      expect(queryCall[0]).toContain('module_id = ?');
      expect(queryCall[0]).toContain('AND');
      expect(queryCall[1]).toEqual(['some-id', 'mod-1']);
    });

    it('correctly maps row data to entity objects', async () => {
      const row = makeDependencyRow({
        id: 'a_b',
        source_id: 'a',
        target_id: 'b',
        type: 'peerDependency',
        created_at: '2025-06-15T12:00:00.000Z',
      });

      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const results = await repo.retrieve();

      expect(results[0].id).toBe('a_b');
      expect(results[0].source_id).toBe('a');
      expect(results[0].target_id).toBe('b');
      expect(results[0].type).toBe('peerDependency');
      expect(results[0].created_at).toBeInstanceOf(Date);
      expect(results[0].created_at.toISOString()).toBe('2025-06-15T12:00:00.000Z');
    });

    it('returns an empty array when no rows match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieve('nonexistent-id');
      expect(results).toEqual([]);
    });

    it('throws RepositoryError when the query fails', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('Query timeout'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });
  });

  describe('delete', () => {
    it('executes a DELETE query with the correct id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.delete('source-1_target-1');

      expect(adapter.query).toHaveBeenCalledOnce();
      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toBe('DELETE FROM dependencies WHERE id = ?');
      expect(queryCall[1]).toEqual(['source-1_target-1']);
    });

    it('throws RepositoryError when the DELETE query fails', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('FK violation'));

      await expect(repo.delete('some-id')).rejects.toThrow(RepositoryError);
    });
  });

  describe('findBySourceId', () => {
    it('returns dependencies matching the source_id', async () => {
      const rows = [
        makeDependencyRow({ id: 'src_a', source_id: 'src', target_id: 'a' }),
        makeDependencyRow({ id: 'src_b', source_id: 'src', target_id: 'b' }),
      ];

      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.findBySourceId('src');

      expect(results).toHaveLength(2);
      expect(results[0].source_id).toBe('src');
      expect(results[1].source_id).toBe('src');

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('WHERE source_id = ?');
      expect(queryCall[1]).toEqual(['src']);
    });

    it('returns an empty array when no dependencies match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.findBySourceId('nonexistent');
      expect(results).toEqual([]);
    });

    it('returns an empty array on query failure (permissive behavior)', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('table not found'));

      const results = await repo.findBySourceId('src');
      expect(results).toEqual([]);
    });

    it('correctly maps row data to entity objects', async () => {
      const row = makeDependencyRow({
        id: 'src_tgt',
        source_id: 'src',
        target_id: 'tgt',
        type: 'devDependency',
        created_at: '2025-03-10T08:30:00.000Z',
      });

      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const results = await repo.findBySourceId('src');

      expect(results[0].id).toBe('src_tgt');
      expect(results[0].type).toBe('devDependency');
      expect(results[0].created_at).toBeInstanceOf(Date);
    });
  });

  describe('findByTargetId', () => {
    it('returns dependencies matching the target_id', async () => {
      const rows = [
        makeDependencyRow({ id: 'a_tgt', source_id: 'a', target_id: 'tgt' }),
        makeDependencyRow({ id: 'b_tgt', source_id: 'b', target_id: 'tgt' }),
      ];

      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.findByTargetId('tgt');

      expect(results).toHaveLength(2);
      expect(results[0].target_id).toBe('tgt');
      expect(results[1].target_id).toBe('tgt');

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('WHERE target_id = ?');
      expect(queryCall[1]).toEqual(['tgt']);
    });

    it('returns an empty array when no dependencies match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.findByTargetId('nonexistent');
      expect(results).toEqual([]);
    });

    it('returns an empty array on query failure (permissive behavior)', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('connection refused'));

      const results = await repo.findByTargetId('tgt');
      expect(results).toEqual([]);
    });

    it('correctly maps row data to entity objects', async () => {
      const row = makeDependencyRow({
        id: 'x_y',
        source_id: 'x',
        target_id: 'y',
        type: 'peerDependency',
        created_at: '2025-12-25T00:00:00.000Z',
      });

      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const results = await repo.findByTargetId('y');

      expect(results[0].id).toBe('x_y');
      expect(results[0].type).toBe('peerDependency');
      expect(results[0].created_at.toISOString()).toBe('2025-12-25T00:00:00.000Z');
    });
  });

  describe('retrieveById', () => {
    it('returns the entity when it exists', async () => {
      const row = makeDependencyRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.retrieveById('source-1_target-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('source-1_target-1');
    });

    it('returns undefined when the entity does not exist', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');
      expect(result).toBeUndefined();
    });

    it('delegates to retrieve with the correct id', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.retrieveById('test-id');

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('id = ?');
      expect(queryCall[1]).toContain('test-id');
    });
  });

  describe('retrieveByModuleId', () => {
    it('returns dependencies for the given module_id', async () => {
      const rows = [
        makeDependencyRow({ id: 'dep-1' }),
        makeDependencyRow({ id: 'dep-2' }),
      ];

      vi.mocked(adapter.query).mockResolvedValueOnce(rows);

      const results = await repo.retrieveByModuleId('mod-123');

      expect(results).toHaveLength(2);

      const queryCall = vi.mocked(adapter.query).mock.calls[0] as [string, unknown[]];
      expect(queryCall[0]).toContain('module_id = ?');
      expect(queryCall[1]).toContain('mod-123');
    });

    it('returns an empty array when no dependencies exist for the module', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieveByModuleId('nonexistent-mod');
      expect(results).toEqual([]);
    });
  });
});
