import { describe, expect, it } from 'vitest';

import { createGraphEdges } from '../createGraphEdges';

import type { DependencyPackageGraph } from '../../components/DependencyGraph/types';

function createBaseGraph(): DependencyPackageGraph {
  return {
    packages: [
      {
        id: 'pkg-1',
        name: 'test-package',
        version: '1.0.0',
        path: '/test',
        created_at: '2024-01-01',
        dependencies: {
          dep: {
            id: 'pkg-external',
            name: 'external-package',
            version: '2.0.0',
          },
        },
        modules: {
          'module-1': {
            id: 'module-1',
            name: 'app.ts',
            package_id: 'pkg-1',
            source: { relativePath: 'src/app.ts' },
            imports: {
              'imp-1': {
                uuid: 'imp-1',
                name: 'utils',
                path: './utils',
              },
            },
          },
          'module-2': {
            id: 'module-2',
            name: 'utils.ts',
            package_id: 'pkg-1',
            source: { relativePath: 'src/utils.ts' },
          },
        },
      },
    ],
  };
}

describe('createGraphEdges import resolution', () => {
  it('resolves extensionless imports to .ts files', () => {
    const graph = createBaseGraph();
    const edges = createGraphEdges(graph);
    const importEdge = edges.find(
      (edge) => edge.data?.type === 'import' && edge.source === 'module-1' && edge.target === 'module-2'
    );

    expect(importEdge).toBeDefined();
  });

  it('resolves directory imports to index.ts files', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-1': {
              id: 'module-1',
              name: 'app.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/app.ts' },
              imports: {
                'imp-1': {
                  uuid: 'imp-1',
                  name: 'components',
                  path: './components',
                },
              },
            },
            'module-2': {
              id: 'module-2',
              name: 'index.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/components/index.ts' },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph);
    const importEdge = edges.find(
      (edge) => edge.data?.type === 'import' && edge.source === 'module-1' && edge.target === 'module-2'
    );

    expect(importEdge).toBeDefined();
  });

  it('resolves directory imports to index.vue files', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-1': {
              id: 'module-1',
              name: 'app.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/app.ts' },
              imports: {
                'imp-1': {
                  uuid: 'imp-1',
                  name: 'components',
                  path: './components',
                },
              },
            },
            'module-2': {
              id: 'module-2',
              name: 'index.vue',
              package_id: 'pkg-1',
              source: { relativePath: 'src/components/index.vue' },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph);
    const importEdge = edges.find(
      (edge) => edge.data?.type === 'import' && edge.source === 'module-1' && edge.target === 'module-2'
    );

    expect(importEdge).toBeDefined();
  });

  it('does not create edges for unresolved imports', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-1': {
              id: 'module-1',
              name: 'app.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/app.ts' },
              imports: {
                'imp-1': {
                  uuid: 'imp-1',
                  name: 'missing',
                  path: './missing',
                },
              },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph);
    const importEdges = edges.filter((edge) => edge.data?.type === 'import');
    expect(importEdges).toHaveLength(0);
  });

  it('does not create graph edges for external metadata imports', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-1': {
              id: 'module-1',
              name: 'app.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/app.ts' },
              imports: {
                'imp-vue': {
                  uuid: 'imp-vue',
                  name: 'ref',
                  path: 'vue',
                  isExternal: true,
                  packageName: 'vue',
                  specifiers: [{ imported: 'ref', kind: 'value' }],
                },
              },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph);
    const importEdges = edges.filter((edge) => edge.data?.type === 'import');
    expect(importEdges).toHaveLength(0);
  });
});

describe('createGraphEdges options', () => {
  it('excludes package dependency edges by default', () => {
    const graph = createBaseGraph();
    const edges = createGraphEdges(graph);
    const packageEdges = edges.filter(
      (edge) =>
        edge.data?.type === 'dependency' ||
        edge.data?.type === 'devDependency' ||
        edge.data?.type === 'peerDependency'
    );

    expect(packageEdges).toHaveLength(0);
  });

  it('includes package dependency edges when requested', () => {
    const graph = createBaseGraph();
    graph.packages.push({
      id: 'pkg-external',
      name: 'external-package',
      version: '2.0.0',
      path: '/external',
      created_at: '2024-01-01',
    });

    const edges = createGraphEdges(graph, { includePackageEdges: true });
    const packageEdges = edges.filter((edge) => edge.data?.type === 'dependency');

    expect(packageEdges).toHaveLength(1);
    expect(packageEdges[0]?.source).toBe('pkg-1');
    expect(packageEdges[0]?.target).toBe('pkg-external');
  });

  it('supports reversing import direction when requested', () => {
    const graph = createBaseGraph();
    const edges = createGraphEdges(graph, { importDirection: 'imported-to-importer' });
    const importEdge = edges.find(
      (edge) => edge.data?.type === 'import' && edge.source === 'module-2' && edge.target === 'module-1'
    );

    expect(importEdge).toBeDefined();
  });
});

describe('createGraphEdges class relationships', () => {
  it('lifts class relationships to module level when requested', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-a': {
              id: 'module-a',
              name: 'a.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/a.ts' },
              classes: {
                A: {
                  id: 'class-a',
                  name: 'A',
                  extends_id: 'class-b',
                },
              },
            },
            'module-b': {
              id: 'module-b',
              name: 'b.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/b.ts' },
              classes: {
                B: {
                  id: 'class-b',
                  name: 'B',
                },
              },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph, { includeClassEdges: false, liftClassEdgesToModuleLevel: true });
    const liftedEdge = edges.find(
      (edge) => edge.data?.type === 'inheritance' && edge.source === 'module-a' && edge.target === 'module-b'
    );
    expect(liftedEdge).toBeDefined();
  });

  it('includes class-level relationships when class edges are enabled', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-a': {
              id: 'module-a',
              name: 'a.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/a.ts' },
              classes: {
                A: {
                  id: 'class-a',
                  name: 'A',
                  extends_id: 'class-b',
                },
              },
            },
            'module-b': {
              id: 'module-b',
              name: 'b.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/b.ts' },
              classes: {
                B: {
                  id: 'class-b',
                  name: 'B',
                },
              },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph, { includeClassEdges: true, liftClassEdgesToModuleLevel: false });
    const classEdge = edges.find(
      (edge) => edge.data?.type === 'inheritance' && edge.source === 'class-a' && edge.target === 'class-b'
    );
    expect(classEdge).toBeDefined();
  });

  it('deduplicates lifted module relationships', () => {
    const graph: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'test-package',
          version: '1.0.0',
          path: '/test',
          created_at: '2024-01-01',
          modules: {
            'module-a': {
              id: 'module-a',
              name: 'a.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/a.ts' },
              classes: {
                A1: {
                  id: 'class-a1',
                  name: 'A1',
                  extends_id: 'class-b1',
                },
                A2: {
                  id: 'class-a2',
                  name: 'A2',
                  extends_id: 'class-b2',
                },
              },
            },
            'module-b': {
              id: 'module-b',
              name: 'b.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/b.ts' },
              classes: {
                B1: {
                  id: 'class-b1',
                  name: 'B1',
                },
                B2: {
                  id: 'class-b2',
                  name: 'B2',
                },
              },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph, { includeClassEdges: false, liftClassEdgesToModuleLevel: true });
    const liftedInheritanceEdges = edges.filter(
      (edge) => edge.data?.type === 'inheritance' && edge.source === 'module-a' && edge.target === 'module-b'
    );
    expect(liftedInheritanceEdges).toHaveLength(1);
  });
});
