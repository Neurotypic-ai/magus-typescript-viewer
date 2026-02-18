// @vitest-environment node
import { vi } from 'vitest';

import { PackageRepository } from '../PackageRepository';
import { Package } from '../../../../shared/types/Package';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../../errors/RepositoryError';

import type { IDatabaseAdapter, QueryParams } from '../../adapter/IDatabaseAdapter';
import type { IPackageCreateDTO } from '../PackageRepository';
import type { IPackageRow } from '../../types/DatabaseResults';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_ISO = '2025-01-15T12:00:00.000Z';

function createMockAdapter(): IDatabaseAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    getDbPath: vi.fn().mockReturnValue(':memory:'),
  };
}

function makePackageRow(overrides: Partial<IPackageRow> = {}): IPackageRow {
  return {
    id: 'pkg-1',
    name: '@scope/my-package',
    version: '1.0.0',
    path: '/packages/my-package',
    created_at: NOW_ISO,
    ...overrides,
  };
}

function makeCreateDTO(overrides: Partial<IPackageCreateDTO> = {}): IPackageCreateDTO {
  return {
    id: 'pkg-1',
    name: '@scope/my-package',
    version: '1.0.0',
    path: '/packages/my-package',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PackageRepository', () => {
  let adapter: IDatabaseAdapter;
  let repo: PackageRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));

    adapter = createMockAdapter();
    repo = new PackageRepository(adapter);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // create()
  // =========================================================================

  describe('create', () => {
    it('inserts a package row and returns a Package instance', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const result = await repo.create(makeCreateDTO());

      expect(result).toBeInstanceOf(Package);
      expect(result.id).toBe('pkg-1');
      expect(result.name).toBe('@scope/my-package');
      expect(result.version).toBe('1.0.0');
      expect(result.path).toBe('/packages/my-package');
      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('passes the correct SQL and parameters to the adapter', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      await repo.create(makeCreateDTO());

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO packages'),
        expect.arrayContaining(['pkg-1', '@scope/my-package', '1.0.0', '/packages/my-package'])
      );
    });

    it('throws EntityNotFoundError when INSERT returns no rows', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(EntityNotFoundError);
    });

    it('creates dependency records for regular dependencies', async () => {
      const row = makePackageRow();
      const depRow = {
        id: 'pkg-1_dep-1',
        source_id: 'pkg-1',
        target_id: 'dep-1',
        type: 'dependency',
        created_at: NOW_ISO,
      };

      // First call: INSERT package, second call: INSERT dependency
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // package INSERT
        .mockResolvedValueOnce([depRow]); // dependency INSERT

      const dto = makeCreateDTO({
        dependencies: new Map([['some-dep', 'dep-1']]),
      });

      const result = await repo.create(dto);

      expect(result).toBeInstanceOf(Package);
      // The dependency INSERT should have been called
      expect(adapter.query).toHaveBeenCalledTimes(2);
    });

    it('creates devDependency records', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // package INSERT
        .mockResolvedValueOnce([
          {
            id: 'pkg-1_dev-1',
            source_id: 'pkg-1',
            target_id: 'dev-1',
            type: 'devDependency',
            created_at: NOW_ISO,
          },
        ]); // devDep INSERT

      const dto = makeCreateDTO({
        devDependencies: new Map([['dev-dep', 'dev-1']]),
      });

      await repo.create(dto);

      // Package INSERT + dependency INSERT
      expect(adapter.query).toHaveBeenCalledTimes(2);
    });

    it('creates peerDependency records', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // package INSERT
        .mockResolvedValueOnce([
          {
            id: 'pkg-1_peer-1',
            source_id: 'pkg-1',
            target_id: 'peer-1',
            type: 'peerDependency',
            created_at: NOW_ISO,
          },
        ]); // peerDep INSERT

      const dto = makeCreateDTO({
        peerDependencies: new Map([['peer-dep', 'peer-1']]),
      });

      await repo.create(dto);

      expect(adapter.query).toHaveBeenCalledTimes(2);
    });

    it('skips self-referencing dependencies', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const dto = makeCreateDTO({
        dependencies: new Map([['self', 'pkg-1']]), // same id as the package itself
      });

      await repo.create(dto);

      // Only the package INSERT -- no dependency INSERT because the target equals the source
      expect(adapter.query).toHaveBeenCalledTimes(1);
    });

    it('silently skips dependency creation failures (external packages)', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // package INSERT
        .mockRejectedValueOnce(new Error('foreign key constraint')); // dependency INSERT fails

      const dto = makeCreateDTO({
        dependencies: new Map([['external', 'ext-1']]),
      });

      // Should not throw despite the dependency creation failure
      const result = await repo.create(dto);
      expect(result).toBeInstanceOf(Package);
    });

    it('wraps unexpected errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('connection lost'));

      await expect(repo.create(makeCreateDTO())).rejects.toThrow(RepositoryError);
    });

    it('rethrows RepositoryError subclasses without wrapping', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      try {
        await repo.create(makeCreateDTO());
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityNotFoundError);
        // Ensure it was NOT double-wrapped
        expect((error as RepositoryError).cause).toBeUndefined();
      }
    });

    it('handles all three dependency types in a single create call', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // package INSERT
        .mockResolvedValueOnce([{ id: 'pkg-1_d1', source_id: 'pkg-1', target_id: 'd1', type: 'dependency', created_at: NOW_ISO }])
        .mockResolvedValueOnce([{ id: 'pkg-1_d2', source_id: 'pkg-1', target_id: 'd2', type: 'devDependency', created_at: NOW_ISO }])
        .mockResolvedValueOnce([{ id: 'pkg-1_d3', source_id: 'pkg-1', target_id: 'd3', type: 'peerDependency', created_at: NOW_ISO }]);

      const dto = makeCreateDTO({
        dependencies: new Map([['dep-a', 'd1']]),
        devDependencies: new Map([['dev-a', 'd2']]),
        peerDependencies: new Map([['peer-a', 'd3']]),
      });

      const result = await repo.create(dto);

      expect(result).toBeInstanceOf(Package);
      // 1 package INSERT + 3 dependency INSERTs
      expect(adapter.query).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // update()
  // =========================================================================

  describe('update', () => {
    it('updates the name field and returns the updated Package', async () => {
      const updatedRow = makePackageRow({ name: 'new-name' });
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([updatedRow]) // UPDATE query
        .mockResolvedValueOnce([updatedRow]) // SELECT for retrieveById -> retrieve
        .mockResolvedValueOnce([]); // findBySourceId for dependency hydration

      const result = await repo.update('pkg-1', { name: 'new-name' });

      expect(result).toBeInstanceOf(Package);
      expect(result.name).toBe('new-name');
    });

    it('updates the version field', async () => {
      const updatedRow = makePackageRow({ version: '2.0.0' });
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([updatedRow]) // UPDATE
        .mockResolvedValueOnce([updatedRow]) // SELECT
        .mockResolvedValueOnce([]); // dependency hydration

      const result = await repo.update('pkg-1', { version: '2.0.0' });

      expect(result.version).toBe('2.0.0');
    });

    it('updates the path field', async () => {
      const updatedRow = makePackageRow({ path: '/new/path' });
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([updatedRow]) // UPDATE
        .mockResolvedValueOnce([updatedRow]) // SELECT
        .mockResolvedValueOnce([]); // dependency hydration

      const result = await repo.update('pkg-1', { path: '/new/path' });

      expect(result.path).toBe('/new/path');
    });

    it('updates multiple fields simultaneously', async () => {
      const updatedRow = makePackageRow({ name: 'renamed', version: '3.0.0' });
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([updatedRow]) // UPDATE
        .mockResolvedValueOnce([updatedRow]) // SELECT
        .mockResolvedValueOnce([]); // dependency hydration

      const result = await repo.update('pkg-1', { name: 'renamed', version: '3.0.0' });

      expect(result.name).toBe('renamed');
      expect(result.version).toBe('3.0.0');
    });

    it('constructs a SET clause with only the provided fields', async () => {
      const updatedRow = makePackageRow({ name: 'updated' });
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([updatedRow]) // UPDATE
        .mockResolvedValueOnce([updatedRow]) // SELECT
        .mockResolvedValueOnce([]); // dependency hydration

      await repo.update('pkg-1', { name: 'updated' });

      const updateCall = vi.mocked(adapter.query).mock.calls[0];
      expect(updateCall).toBeDefined();
      const sql = updateCall![0] as string;
      expect(sql).toContain('UPDATE packages SET name = ?');
      expect(sql).not.toContain('version');
      expect(sql).not.toContain('path');
    });

    it('throws NoFieldsToUpdateError when no fields are provided', async () => {
      await expect(repo.update('pkg-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });

    it('throws EntityNotFoundError when the package does not exist after update', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([]) // UPDATE returns empty
        .mockResolvedValueOnce([]); // SELECT returns empty (package not found)

      await expect(repo.update('nonexistent', { name: 'x' })).rejects.toThrow(EntityNotFoundError);
    });

    it('wraps unexpected errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.update('pkg-1', { name: 'x' })).rejects.toThrow(RepositoryError);
    });

    it('rethrows RepositoryError subclasses without double-wrapping', async () => {
      await expect(repo.update('pkg-1', {})).rejects.toThrow(NoFieldsToUpdateError);
    });
  });

  // =========================================================================
  // retrieve()
  // =========================================================================

  describe('retrieve', () => {
    it('retrieves all packages when called with no arguments', async () => {
      const rows = [makePackageRow({ id: 'pkg-1' }), makePackageRow({ id: 'pkg-2', name: 'other' })];
      vi.mocked(adapter.query)
        .mockResolvedValueOnce(rows) // SELECT *
        .mockResolvedValueOnce([]) // dependency hydration for pkg-1
        .mockResolvedValueOnce([]); // dependency hydration for pkg-2

      const results = await repo.retrieve();

      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(Package);
      expect(results[1]).toBeInstanceOf(Package);
    });

    it('filters by id when id is provided', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // SELECT with WHERE id = ?
        .mockResolvedValueOnce([]); // dependency hydration

      await repo.retrieve('pkg-1');

      const selectCall = vi.mocked(adapter.query).mock.calls[0];
      const sql = selectCall![0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('id = ?');
      expect(selectCall![1]).toContain('pkg-1');
    });

    it('filters by module_id when module_id is provided', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([]) // SELECT with WHERE module_id = ?
        ;

      await repo.retrieve(undefined, 'mod-1');

      const selectCall = vi.mocked(adapter.query).mock.calls[0];
      const sql = selectCall![0] as string;
      expect(sql).toContain('module_id = ?');
      expect(selectCall![1]).toContain('mod-1');
    });

    it('filters by both id and module_id when both are provided', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([]) // SELECT with WHERE id = ? AND module_id = ?
        ;

      await repo.retrieve('pkg-1', 'mod-1');

      const selectCall = vi.mocked(adapter.query).mock.calls[0];
      const sql = selectCall![0] as string;
      expect(sql).toContain('id = ?');
      expect(sql).toContain('AND');
      expect(sql).toContain('module_id = ?');
    });

    it('returns an empty array when no packages match', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const results = await repo.retrieve('nonexistent');

      expect(results).toEqual([]);
    });

    it('hydrates dependencies from the dependency repository', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // SELECT packages
        .mockResolvedValueOnce([
          { id: 'pkg-1_dep-1', source_id: 'pkg-1', target_id: 'dep-1', type: 'dependency', created_at: NOW_ISO },
          { id: 'pkg-1_dev-1', source_id: 'pkg-1', target_id: 'dev-1', type: 'devDependency', created_at: NOW_ISO },
          { id: 'pkg-1_peer-1', source_id: 'pkg-1', target_id: 'peer-1', type: 'peerDependency', created_at: NOW_ISO },
        ]); // findBySourceId

      const results = await repo.retrieve('pkg-1');

      expect(results).toHaveLength(1);
      const pkg = results[0]!;
      expect(pkg.dependencies).toBeInstanceOf(Map);
      expect((pkg.dependencies as Map<string, Package>).has('dep-1')).toBe(true);
      expect((pkg.devDependencies as Map<string, Package>).has('dev-1')).toBe(true);
      expect((pkg.peerDependencies as Map<string, Package>).has('peer-1')).toBe(true);
    });

    it('returns package with empty dependency maps when hydration fails', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // SELECT packages
        .mockRejectedValueOnce(new Error('dependency table missing')); // findBySourceId fails

      const results = await repo.retrieve('pkg-1');

      expect(results).toHaveLength(1);
      const pkg = results[0]!;
      expect(pkg).toBeInstanceOf(Package);
      expect((pkg.dependencies as Map<string, Package>).size).toBe(0);
      expect((pkg.devDependencies as Map<string, Package>).size).toBe(0);
      expect((pkg.peerDependencies as Map<string, Package>).size).toBe(0);
    });

    it('wraps unexpected errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.retrieve()).rejects.toThrow(RepositoryError);
    });
  });

  // =========================================================================
  // retrieveById()
  // =========================================================================

  describe('retrieveById', () => {
    it('returns a Package when found', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // SELECT
        .mockResolvedValueOnce([]); // dependency hydration

      const result = await repo.retrieveById('pkg-1');

      expect(result).toBeInstanceOf(Package);
      expect(result?.id).toBe('pkg-1');
    });

    it('returns undefined when the package is not found', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      const result = await repo.retrieveById('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // retrieveByModuleId()
  // =========================================================================

  describe('retrieveByModuleId', () => {
    it('delegates to retrieve with module_id parameter', async () => {
      vi.mocked(adapter.query).mockResolvedValueOnce([]);

      await repo.retrieveByModuleId('mod-1');

      const selectCall = vi.mocked(adapter.query).mock.calls[0];
      const sql = selectCall![0] as string;
      expect(sql).toContain('module_id = ?');
    });

    it('returns matching packages', async () => {
      const rows = [makePackageRow({ id: 'pkg-a' }), makePackageRow({ id: 'pkg-b' })];
      vi.mocked(adapter.query)
        .mockResolvedValueOnce(rows) // SELECT
        .mockResolvedValueOnce([]) // dep hydration for pkg-a
        .mockResolvedValueOnce([]); // dep hydration for pkg-b

      const results = await repo.retrieveByModuleId('mod-1');

      expect(results).toHaveLength(2);
    });
  });

  // =========================================================================
  // delete()
  // =========================================================================

  describe('delete', () => {
    it('deletes dependencies first, then the package', async () => {
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([]) // DELETE dependencies
        .mockResolvedValueOnce([]); // DELETE package

      await repo.delete('pkg-1');

      expect(adapter.query).toHaveBeenCalledTimes(2);

      // First call: delete dependencies
      const depDeleteCall = vi.mocked(adapter.query).mock.calls[0];
      const depSql = depDeleteCall![0] as string;
      expect(depSql).toContain('DELETE FROM dependencies');
      expect(depSql).toContain('source_id = ?');
      expect(depSql).toContain('target_id = ?');
      expect(depDeleteCall![1]).toEqual(['pkg-1', 'pkg-1']);

      // Second call: delete the package
      const pkgDeleteCall = vi.mocked(adapter.query).mock.calls[1];
      const pkgSql = pkgDeleteCall![0] as string;
      expect(pkgSql).toContain('DELETE FROM packages');
      expect(pkgDeleteCall![1]).toEqual(['pkg-1']);
    });

    it('wraps unexpected errors in RepositoryError', async () => {
      vi.mocked(adapter.query).mockRejectedValueOnce(new Error('constraint violation'));

      await expect(repo.delete('pkg-1')).rejects.toThrow(RepositoryError);
    });

    it('rethrows RepositoryError subclasses without wrapping', async () => {
      const repoError = new RepositoryError('already gone', 'delete', '[PackageRepository]');
      vi.mocked(adapter.query).mockRejectedValueOnce(repoError);

      await expect(repo.delete('pkg-1')).rejects.toThrow(RepositoryError);
    });
  });

  // =========================================================================
  // constructor
  // =========================================================================

  describe('constructor', () => {
    it('initializes with the correct error tag and table name', () => {
      // Access protected properties via cast for verification
      const repoAsAny = repo as unknown as { errorTag: string; tableName: string };
      expect(repoAsAny.errorTag).toBe('[PackageRepository]');
      expect(repoAsAny.tableName).toBe('packages');
    });

    it('creates a DependencyRepository internally', () => {
      // The DependencyRepository is private, but we can verify it works
      // by testing dependency-related behavior in create/retrieve
      expect(repo).toBeInstanceOf(PackageRepository);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles empty dependency maps without errors', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query).mockResolvedValueOnce([row]);

      const dto = makeCreateDTO({
        dependencies: new Map(),
        devDependencies: new Map(),
        peerDependencies: new Map(),
      });

      const result = await repo.create(dto);

      expect(result).toBeInstanceOf(Package);
      // Only the package INSERT -- no dependency INSERTs because maps are empty
      expect(adapter.query).toHaveBeenCalledTimes(1);
    });

    it('handles multiple dependencies of the same type', async () => {
      const row = makePackageRow();
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row]) // package INSERT
        .mockResolvedValueOnce([{ id: 'd1', source_id: 'pkg-1', target_id: 'a', type: 'dependency', created_at: NOW_ISO }])
        .mockResolvedValueOnce([{ id: 'd2', source_id: 'pkg-1', target_id: 'b', type: 'dependency', created_at: NOW_ISO }])
        .mockResolvedValueOnce([{ id: 'd3', source_id: 'pkg-1', target_id: 'c', type: 'dependency', created_at: NOW_ISO }]);

      const dto = makeCreateDTO({
        dependencies: new Map([
          ['dep-a', 'a'],
          ['dep-b', 'b'],
          ['dep-c', 'c'],
        ]),
      });

      await repo.create(dto);

      // 1 package INSERT + 3 dependency INSERTs
      expect(adapter.query).toHaveBeenCalledTimes(4);
    });

    it('returns Package instances with correct Date objects from retrieve', async () => {
      const row = makePackageRow({ created_at: '2024-06-15T09:30:00.000Z' });
      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([]); // dep hydration

      const results = await repo.retrieve('pkg-1');

      expect(results[0]!.created_at).toBeInstanceOf(Date);
      expect(results[0]!.created_at.toISOString()).toBe('2024-06-15T09:30:00.000Z');
    });

    it('converts IPackageRow field values to strings in createPackageWithDependencies', async () => {
      // Simulate adapter returning non-string values (e.g., DuckDB native types)
      const row = {
        id: 'pkg-1',
        name: 'my-pkg',
        version: '1.0.0',
        path: '/path',
        created_at: '2025-01-01T00:00:00.000Z',
      } as IPackageRow;

      vi.mocked(adapter.query)
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([]); // dep hydration

      const results = await repo.retrieve('pkg-1');
      const pkg = results[0]!;

      expect(typeof pkg.id).toBe('string');
      expect(typeof pkg.name).toBe('string');
      expect(typeof pkg.version).toBe('string');
      expect(typeof pkg.path).toBe('string');
    });
  });
});
