import { describe, expect, it } from 'vitest';

import { createGraphEdges } from '../createGraphEdges';

import type { DependencyPackageGraph } from '../../components/DependencyGraph/types';

describe('createGraphEdges import resolution', () => {
  it('resolves extensionless imports to .ts files', () => {
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

    const edges = createGraphEdges(graph);
    const importEdge = edges.find(
      (e) => e.data?.type === 'import' && e.source === 'module-2' && e.target === 'module-1'
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
      (e) => e.data?.type === 'import' && e.source === 'module-2' && e.target === 'module-1'
    );

    expect(importEdge).toBeDefined();
  });

  it('resolves extensionless index imports', () => {
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
                  name: 'utils',
                  path: './utils/index',
                },
              },
            },
            'module-2': {
              id: 'module-2',
              name: 'index.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/utils/index.ts' },
            },
          },
        },
      ],
    };

    const edges = createGraphEdges(graph);
    const importEdge = edges.find(
      (e) => e.data?.type === 'import' && e.source === 'module-2' && e.target === 'module-1'
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
    const importEdges = edges.filter((e) => e.data?.type === 'import');
    expect(importEdges).toHaveLength(0);
  });
});
