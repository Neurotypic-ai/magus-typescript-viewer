import type { DatabaseRow, IDatabaseAdapter, QueryResult } from '../../db/adapter/IDatabaseAdapter';
import { buildImportGraph } from '../import-graph';

import type { ImportGraph } from '../import-graph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ModuleRowData {
  id: string;
  package_id: string;
  name: string;
  directory: string;
  relative_path: string;
  is_barrel: boolean | string;
  line_count: number | string;
}

interface ImportRowData {
  id: string;
  module_id: string;
  source: string;
  is_type_only: boolean | string;
}

/**
 * Builds a minimal mock IDatabaseAdapter whose `query` method dispatches
 * pre-canned rows based on the SQL statement prefix.
 */
function createMockAdapter(
  moduleRows: ModuleRowData[],
  importRows: ImportRowData[],
): IDatabaseAdapter {
  return {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async init() {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async close() {},
    async transaction<T>(cb: () => Promise<T>) {
      return cb();
    },
    getDbPath() {
      return ':memory:';
    },
    query<T extends DatabaseRow>(sql: string): Promise<QueryResult<T>> {
      const upper = sql.toUpperCase();
      if (upper.includes('FROM MODULES')) {
        return Promise.resolve(moduleRows as unknown as QueryResult<T>);
      }
      if (upper.includes('FROM IMPORTS')) {
        return Promise.resolve(importRows as unknown as QueryResult<T>);
      }
      return Promise.resolve([] as unknown as QueryResult<T>);
    },
  };
}

/** Shorthand to build a module row with sensible defaults. */
function mod(
  id: string,
  relativePath: string,
  overrides: Partial<ModuleRowData> = {},
): ModuleRowData {
  return {
    id,
    package_id: overrides.package_id ?? 'pkg-1',
    name: overrides.name ?? (relativePath.split('/').pop() ?? '').replace(/\.ts$/, ''),
    directory: overrides.directory ?? '/',
    relative_path: relativePath,
    is_barrel: overrides.is_barrel ?? false,
    line_count: overrides.line_count ?? 10,
  };
}

/** Shorthand to build an import row. */
function imp(
  id: string,
  moduleId: string,
  source: string,
  isTypeOnly: boolean | string = false,
): ImportRowData {
  return { id, module_id: moduleId, source, is_type_only: isTypeOnly };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildImportGraph', () => {
  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------
  describe('with no modules', () => {
    it('returns empty collections', async () => {
      const adapter = createMockAdapter([], []);
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.size).toBe(0);
      expect(graph.reverseAdjacency.size).toBe(0);
      expect(graph.modules.size).toBe(0);
      expect(graph.nodeIds.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Single module, no imports
  // -----------------------------------------------------------------------
  describe('with a single module and no imports', () => {
    let graph: ImportGraph;

    beforeEach(async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/utils/helpers.ts')],
        [],
      );
      graph = await buildImportGraph(adapter);
    });

    it('registers the module in nodeIds', () => {
      expect(graph.nodeIds.has('m1')).toBe(true);
      expect(graph.nodeIds.size).toBe(1);
    });

    it('populates the modules metadata map', () => {
      const meta = graph.modules.get('m1');
      expect(meta).toBeDefined();
      expect(meta!.relativePath).toBe('src/utils/helpers.ts');
      expect(meta!.name).toBe('helpers');
      expect(meta!.packageId).toBe('pkg-1');
    });

    it('creates empty adjacency sets for the module', () => {
      expect(graph.adjacency.get('m1')?.size).toBe(0);
      expect(graph.reverseAdjacency.get('m1')?.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Metadata mapping
  // -----------------------------------------------------------------------
  describe('module metadata', () => {
    it('converts is_barrel string "true" to boolean true', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/index.ts', { is_barrel: 'true' })],
        [],
      );
      const graph = await buildImportGraph(adapter);
      expect(graph.modules.get('m1')!.isBarrel).toBe(true);
    });

    it('converts is_barrel string "1" to boolean true', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/index.ts', { is_barrel: '1' })],
        [],
      );
      const graph = await buildImportGraph(adapter);
      expect(graph.modules.get('m1')!.isBarrel).toBe(true);
    });

    it('converts is_barrel string "false" to boolean false', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/foo.ts', { is_barrel: 'false' })],
        [],
      );
      const graph = await buildImportGraph(adapter);
      expect(graph.modules.get('m1')!.isBarrel).toBe(false);
    });

    it('converts line_count string to number', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/foo.ts', { line_count: '42' })],
        [],
      );
      const graph = await buildImportGraph(adapter);
      expect(graph.modules.get('m1')!.lineCount).toBe(42);
    });

    it('defaults lineCount to 0 for non-numeric values', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/foo.ts', { line_count: 'NaN' as unknown as string })],
        [],
      );
      const graph = await buildImportGraph(adapter);
      expect(graph.modules.get('m1')!.lineCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Relative imports
  // -----------------------------------------------------------------------
  describe('relative imports', () => {
    it('resolves a simple relative import between two modules', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/components/App.ts'),
          mod('m2', 'src/utils/helpers.ts'),
        ],
        [imp('i1', 'm1', '../utils/helpers')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
      expect(graph.reverseAdjacency.get('m2')?.has('m1')).toBe(true);
    });

    it('resolves a same-directory relative import', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/utils/foo.ts'),
          mod('m2', 'src/utils/bar.ts'),
        ],
        [imp('i1', 'm1', './bar')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });

    it('resolves import with file extension', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/a.ts'),
          mod('m2', 'src/b.ts'),
        ],
        [imp('i1', 'm1', './b.ts')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });

    it('resolves import of an index barrel file', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/app.ts'),
          mod('m2', 'src/components/index.ts', { is_barrel: true }),
        ],
        [imp('i1', 'm1', './components/index')],
      );
      const graph = await buildImportGraph(adapter);

      // normalizePath strips /index, so './components/index' -> 'src/components'
      // and 'src/components/index.ts' normalizes to 'src/components'
      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Alias imports (@/ and src/)
  // -----------------------------------------------------------------------
  describe('alias imports', () => {
    it('resolves @/ alias imports', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/views/Dashboard.ts'),
          mod('m2', 'src/utils/api.ts'),
        ],
        [imp('i1', 'm1', '@/utils/api')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });

    it('resolves src/ prefix imports', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/views/Dashboard.ts'),
          mod('m2', 'src/utils/api.ts'),
        ],
        [imp('i1', 'm1', 'src/utils/api')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // External / non-internal imports are ignored
  // -----------------------------------------------------------------------
  describe('external imports', () => {
    it('ignores bare-specifier npm imports', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/app.ts')],
        [imp('i1', 'm1', 'lodash')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.size).toBe(0);
    });

    it('ignores scoped npm packages', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/app.ts')],
        [imp('i1', 'm1', '@vue/runtime-core')],
      );
      const graph = await buildImportGraph(adapter);

      // @vue/... does NOT start with @/ so isInternalImport returns false
      expect(graph.adjacency.get('m1')?.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Self-imports are excluded
  // -----------------------------------------------------------------------
  describe('self-imports', () => {
    it('does not add an edge when a module imports itself', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/utils/helpers.ts')],
        [imp('i1', 'm1', './helpers')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m1')).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // Unresolved imports
  // -----------------------------------------------------------------------
  describe('unresolved imports', () => {
    it('ignores internal imports that do not resolve to a known module', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/app.ts')],
        [imp('i1', 'm1', './nonExistentModule')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple modules with a chain of imports (A -> B -> C)
  // -----------------------------------------------------------------------
  describe('import chain (A -> B -> C)', () => {
    let graph: ImportGraph;

    beforeEach(async () => {
      const adapter = createMockAdapter(
        [
          mod('a', 'src/a.ts'),
          mod('b', 'src/b.ts'),
          mod('c', 'src/c.ts'),
        ],
        [
          imp('i1', 'a', './b'),
          imp('i2', 'b', './c'),
        ],
      );
      graph = await buildImportGraph(adapter);
    });

    it('has 3 nodes', () => {
      expect(graph.nodeIds.size).toBe(3);
    });

    it('builds the correct forward adjacency', () => {
      expect(graph.adjacency.get('a')?.has('b')).toBe(true);
      expect(graph.adjacency.get('a')?.has('c')).toBeFalsy();
      expect(graph.adjacency.get('b')?.has('c')).toBe(true);
      expect(graph.adjacency.get('c')?.size).toBe(0);
    });

    it('builds the correct reverse adjacency', () => {
      expect(graph.reverseAdjacency.get('a')?.size).toBe(0);
      expect(graph.reverseAdjacency.get('b')?.has('a')).toBe(true);
      expect(graph.reverseAdjacency.get('c')?.has('b')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Circular imports (A -> B -> A)
  // -----------------------------------------------------------------------
  describe('circular imports', () => {
    let graph: ImportGraph;

    beforeEach(async () => {
      const adapter = createMockAdapter(
        [
          mod('a', 'src/a.ts'),
          mod('b', 'src/b.ts'),
        ],
        [
          imp('i1', 'a', './b'),
          imp('i2', 'b', './a'),
        ],
      );
      graph = await buildImportGraph(adapter);
    });

    it('records both directions in forward adjacency', () => {
      expect(graph.adjacency.get('a')?.has('b')).toBe(true);
      expect(graph.adjacency.get('b')?.has('a')).toBe(true);
    });

    it('records both directions in reverse adjacency', () => {
      expect(graph.reverseAdjacency.get('a')?.has('b')).toBe(true);
      expect(graph.reverseAdjacency.get('b')?.has('a')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Circular imports with three nodes (A -> B -> C -> A)
  // -----------------------------------------------------------------------
  describe('three-node circular imports (A -> B -> C -> A)', () => {
    let graph: ImportGraph;

    beforeEach(async () => {
      const adapter = createMockAdapter(
        [
          mod('a', 'src/a.ts'),
          mod('b', 'src/b.ts'),
          mod('c', 'src/c.ts'),
        ],
        [
          imp('i1', 'a', './b'),
          imp('i2', 'b', './c'),
          imp('i3', 'c', './a'),
        ],
      );
      graph = await buildImportGraph(adapter);
    });

    it('each node imports exactly one other node', () => {
      expect(graph.adjacency.get('a')?.size).toBe(1);
      expect(graph.adjacency.get('b')?.size).toBe(1);
      expect(graph.adjacency.get('c')?.size).toBe(1);
    });

    it('each node is imported by exactly one other node', () => {
      expect(graph.reverseAdjacency.get('a')?.size).toBe(1);
      expect(graph.reverseAdjacency.get('b')?.size).toBe(1);
      expect(graph.reverseAdjacency.get('c')?.size).toBe(1);
    });

    it('forms the correct cycle', () => {
      expect(graph.adjacency.get('a')?.has('b')).toBe(true);
      expect(graph.adjacency.get('b')?.has('c')).toBe(true);
      expect(graph.adjacency.get('c')?.has('a')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple imports from the same module
  // -----------------------------------------------------------------------
  describe('multiple imports from same source', () => {
    it('deduplicates edges in adjacency', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/a.ts'),
          mod('m2', 'src/b.ts'),
        ],
        [
          imp('i1', 'm1', './b'),
          imp('i2', 'm1', './b'),
        ],
      );
      const graph = await buildImportGraph(adapter);

      // Set naturally deduplicates
      expect(graph.adjacency.get('m1')?.size).toBe(1);
      expect(graph.reverseAdjacency.get('m2')?.size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Fan-out (one module imports many)
  // -----------------------------------------------------------------------
  describe('fan-out pattern', () => {
    it('records all outbound edges from a single module', async () => {
      const adapter = createMockAdapter(
        [
          mod('hub', 'src/hub.ts'),
          mod('a', 'src/a.ts'),
          mod('b', 'src/b.ts'),
          mod('c', 'src/c.ts'),
        ],
        [
          imp('i1', 'hub', './a'),
          imp('i2', 'hub', './b'),
          imp('i3', 'hub', './c'),
        ],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('hub')?.size).toBe(3);
      expect(graph.adjacency.get('hub')?.has('a')).toBe(true);
      expect(graph.adjacency.get('hub')?.has('b')).toBe(true);
      expect(graph.adjacency.get('hub')?.has('c')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Fan-in (many modules import one)
  // -----------------------------------------------------------------------
  describe('fan-in pattern', () => {
    it('records all inbound edges to a single module', async () => {
      const adapter = createMockAdapter(
        [
          mod('shared', 'src/shared.ts'),
          mod('a', 'src/a.ts'),
          mod('b', 'src/b.ts'),
          mod('c', 'src/c.ts'),
        ],
        [
          imp('i1', 'a', './shared'),
          imp('i2', 'b', './shared'),
          imp('i3', 'c', './shared'),
        ],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.reverseAdjacency.get('shared')?.size).toBe(3);
      expect(graph.reverseAdjacency.get('shared')?.has('a')).toBe(true);
      expect(graph.reverseAdjacency.get('shared')?.has('b')).toBe(true);
      expect(graph.reverseAdjacency.get('shared')?.has('c')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // packageId filtering
  // -----------------------------------------------------------------------
  describe('packageId filtering', () => {
    it('passes packageId as a parameter in the SQL query', async () => {
      const queryCalls: { sql: string; params: unknown[] }[] = [];

      const adapter: IDatabaseAdapter = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async init() {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async close() {},
        async transaction<T>(cb: () => Promise<T>) {
          return cb();
        },
        getDbPath() {
          return ':memory:';
        },
        query<T extends DatabaseRow>(
          sql: string,
          params: unknown[] = [],
        ): Promise<QueryResult<T>> {
          queryCalls.push({ sql, params });
          return Promise.resolve([] as unknown as QueryResult<T>);
        },
      };

      await buildImportGraph(adapter, 'pkg-42');

      // Two queries: one for modules, one for imports
      expect(queryCalls).toHaveLength(2);

      // Both should contain WHERE package_id = ?
      expect(queryCalls[0]!.sql).toContain('WHERE package_id = ?');
      expect(queryCalls[0]!.params).toEqual(['pkg-42']);

      expect(queryCalls[1]!.sql).toContain('WHERE package_id = ?');
      expect(queryCalls[1]!.params).toEqual(['pkg-42']);
    });

    it('does not use WHERE clause when packageId is omitted', async () => {
      const queryCalls: { sql: string; params: unknown[] }[] = [];

      const adapter: IDatabaseAdapter = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async init() {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async close() {},
        async transaction<T>(cb: () => Promise<T>) {
          return cb();
        },
        getDbPath() {
          return ':memory:';
        },
        query<T extends DatabaseRow>(
          sql: string,
          params: unknown[] = [],
        ): Promise<QueryResult<T>> {
          queryCalls.push({ sql, params });
          return Promise.resolve([] as unknown as QueryResult<T>);
        },
      };

      await buildImportGraph(adapter);

      expect(queryCalls).toHaveLength(2);
      expect(queryCalls[0]!.sql).not.toContain('WHERE');
      expect(queryCalls[1]!.sql).not.toContain('WHERE');
      expect(queryCalls[0]!.params).toEqual([]);
      expect(queryCalls[1]!.params).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Nested directory resolution
  // -----------------------------------------------------------------------
  describe('nested directory path resolution', () => {
    it('resolves deeply nested relative imports', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/features/auth/login/LoginForm.ts'),
          mod('m2', 'src/shared/utils/validation.ts'),
        ],
        [imp('i1', 'm1', '../../../shared/utils/validation')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Type-only imports are still tracked
  // -----------------------------------------------------------------------
  describe('type-only imports', () => {
    it('tracks type-only imports in the graph', async () => {
      const adapter = createMockAdapter(
        [
          mod('m1', 'src/a.ts'),
          mod('m2', 'src/b.ts'),
        ],
        [imp('i1', 'm1', './b', true)],
      );
      const graph = await buildImportGraph(adapter);

      // The function does not differentiate type-only imports
      expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Import from unknown module_id
  // -----------------------------------------------------------------------
  describe('import from unknown source module', () => {
    it('ignores imports whose module_id is not in the modules map', async () => {
      const adapter = createMockAdapter(
        [mod('m1', 'src/a.ts')],
        // module_id 'ghost' does not exist in modules
        [imp('i1', 'ghost', './a')],
      );
      const graph = await buildImportGraph(adapter);

      expect(graph.adjacency.get('m1')?.size).toBe(0);
      expect(graph.reverseAdjacency.get('m1')?.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // File extension normalization for various extensions
  // -----------------------------------------------------------------------
  describe('file extension normalization', () => {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    for (const ext of extensions) {
      it(`resolves import to module with ${ext} extension`, async () => {
        const adapter = createMockAdapter(
          [
            mod('m1', 'src/a.ts'),
            mod('m2', `src/b${ext}`),
          ],
          [imp('i1', 'm1', `./b${ext}`)],
        );
        const graph = await buildImportGraph(adapter);

        expect(graph.adjacency.get('m1')?.has('m2')).toBe(true);
      });
    }
  });
});
