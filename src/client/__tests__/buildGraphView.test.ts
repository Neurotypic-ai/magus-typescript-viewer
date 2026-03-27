import { describe, expect, it } from 'vitest';

import {
  applyEdgeVisibility,
  buildOverviewGraph,
  buildSymbolDrilldownGraph,
  filterNodeChangesForFolderMode,
} from '../graph/buildGraphView';

import type { NodeChange } from '@vue-flow/core';

import type { PackageGraph } from '../../shared/types/Package';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

describe('applyEdgeVisibility', () => {
  it('keeps uses edges visible while honoring enabled relationship filters for others', () => {
    const edges: GraphEdge[] = [
      {
        id: 'import-edge',
        source: 'a',
        target: 'b',
        hidden: false,
        data: { type: 'import' },
      } as GraphEdge,
      {
        id: 'inheritance-edge',
        source: 'b',
        target: 'c',
        hidden: false,
        data: { type: 'inheritance' },
      } as GraphEdge,
      {
        id: 'uses-edge',
        source: 'c',
        target: 'd',
        hidden: false,
        data: { type: 'uses', usageKind: 'property' },
      } as GraphEdge,
    ];

    const result = applyEdgeVisibility(edges, ['import']);

    expect(result.find((edge) => edge.id === 'import-edge')?.hidden).toBe(false);
    expect(result.find((edge) => edge.id === 'inheritance-edge')?.hidden).toBe(true);
    expect(result.find((edge) => edge.id === 'uses-edge')?.hidden).toBe(false);
  });

  it('keeps contains edges visible regardless of relationship filters', () => {
    const edges: GraphEdge[] = [
      {
        id: 'contains-edge',
        source: 'a',
        target: 'b',
        hidden: false,
        data: { type: 'contains' },
      } as GraphEdge,
    ];

    const result = applyEdgeVisibility(edges, ['import']);
    expect(result[0]?.hidden).toBe(false);
  });
});

describe('buildOverviewGraph', () => {
  it('filters out test modules when hideTestFiles is enabled and annotates orphan diagnostics', () => {
    const data: PackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg',
          version: '1.0.0',
          path: '/pkg',
          created_at: '2024-01-01T00:00:00.000Z',
          dependencies: {},
          devDependencies: {},
          peerDependencies: {},
          modules: {
            m1: {
              id: 'module-main',
              name: 'main.ts',
              package_id: 'pkg-1',
              source: { directory: 'src', name: 'main.ts', filename: 'main.ts', relativePath: 'src/main.ts' },
              imports: {},
              created_at: '2024-01-01T00:00:00.000Z',
              classes: {},
              interfaces: {},
              exports: {},
              typeAliases: {},
              enums: {},
              functions: {},
              variables: {},
              symbol_references: {},
              packages: {},
              referencePaths: [],
            },
            m2: {
              id: 'module-test',
              name: 'main.test.ts',
              package_id: 'pkg-1',
              source: {
                directory: 'src',
                name: 'main.test.ts',
                filename: 'main.test.ts',
                relativePath: 'src/main.test.ts',
              },
              imports: {},
              created_at: '2024-01-01T00:00:00.000Z',
              classes: {},
              interfaces: {},
              exports: {},
              typeAliases: {},
              enums: {},
              functions: {},
              variables: {},
              symbol_references: {},
              packages: {},
              referencePaths: [],
            },
          },
        },
      ],
    };

    const result = buildOverviewGraph({
      data,
      enabledRelationshipTypes: ['import'],
      direction: 'LR',
      collapsedFolderIds: new Set(),
      hideTestFiles: true,
      highlightOrphanGlobal: true,
    });

    expect(result.nodes.some((node) => node.id === 'module-test')).toBe(false);
    const mainNode = result.nodes.find((node) => node.id === 'module-main');
    expect(mainNode?.data?.diagnostics?.orphanCurrent).toBe(true);
    expect(mainNode?.data?.diagnostics?.orphanGlobal).toBe(true);
  });

  it('returns a semantic snapshot and preserves direct cross-folder module edges in folder mode', () => {
    const data: PackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg',
          version: '1.0.0',
          path: '/pkg',
          created_at: '2024-01-01T00:00:00.000Z',
          dependencies: {},
          devDependencies: {},
          peerDependencies: {},
          modules: {
            a: {
              id: 'module-a',
              name: 'a.ts',
              package_id: 'pkg-1',
              source: { directory: 'src', name: 'a.ts', filename: 'a.ts', relativePath: 'src/a/a.ts' },
              imports: {
                i1: {
                  uuid: 'i1',
                  name: 'b',
                  fullPath: '../b/b',
                  relativePath: 'src/b/b.ts',
                  specifiers: new Map(),
                  depth: 0,
                },
              },
              created_at: '2024-01-01T00:00:00.000Z',
              classes: {},
              interfaces: {},
              exports: {},
              typeAliases: {},
              enums: {},
              functions: {},
              variables: {},
              symbol_references: {},
              packages: {},
              referencePaths: [],
            },
            b: {
              id: 'module-b',
              name: 'b.ts',
              package_id: 'pkg-1',
              source: { directory: 'src', name: 'b.ts', filename: 'b.ts', relativePath: 'src/b/b.ts' },
              imports: {},
              created_at: '2024-01-01T00:00:00.000Z',
              classes: {},
              interfaces: {},
              exports: {},
              typeAliases: {},
              enums: {},
              functions: {},
              variables: {},
              symbol_references: {},
              packages: {},
              referencePaths: [],
            },
          },
        },
      ],
    };

    const result = buildOverviewGraph({
      data,
      enabledRelationshipTypes: ['import'],
      direction: 'LR',
      collapsedFolderIds: new Set(),
      hideTestFiles: false,
      highlightOrphanGlobal: false,
    });

    expect(result.semanticSnapshot).toBeDefined();
    expect(result.semanticSnapshot?.nodes.some((node) => node.type === 'group')).toBe(false);
    expect(result.edges.some((edge) => 'highwaySegment' in (edge.data ?? {}))).toBe(false);
    // Cross-folder module edges are lifted to folder→folder trunk edges
    expect(
      result.edges.some(
        (edge) => edge.type === 'crossFolder' && edge.source.includes('src/a') && edge.target.includes('src/b')
      )
    ).toBe(true);
    // Stub edges connect the source module to the folder boundary
    expect(
      result.edges.some(
        (edge) => edge.type === 'folderStub' && edge.source === 'module-a'
      )
    ).toBe(true);
  });
});

describe('buildSymbolDrilldownGraph', () => {
  it('creates uses edges with usageKind metadata from module symbol references', () => {
    const graphData: PackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg',
          version: '1.0.0',
          path: '/pkg',
          created_at: '2024-01-01T00:00:00.000Z',
          dependencies: {},
          devDependencies: {},
          peerDependencies: {},
          modules: {
            mod: {
              id: 'module-1',
              name: 'module.ts',
              package_id: 'pkg-1',
              source: { directory: 'src', name: 'module.ts', filename: 'module.ts', relativePath: 'src/module.ts' },
              imports: {},
              created_at: '2024-01-01T00:00:00.000Z',
              interfaces: {},
              exports: {},
              typeAliases: {},
              enums: {},
              functions: {},
              variables: {},
              packages: {},
              referencePaths: [],
              classes: {
                Service: {
                  id: 'class-1',
                  package_id: 'pkg-1',
                  module_id: 'module-1',
                  name: 'Service',
                  created_at: '2024-01-01T00:00:00.000Z',
                  implemented_interfaces: {},
                  methods: [
                    {
                      id: 'method-1',
                      package_id: 'pkg-1',
                      module_id: 'module-1',
                      parent_id: 'class-1',
                      name: 'load',
                      created_at: '2024-01-01T00:00:00.000Z',
                      parameters: {},
                      return_type: 'void',
                      is_static: false,
                      is_async: false,
                      visibility: 'public',
                      signature: 'load(): void',
                    },
                  ],
                  properties: [
                    {
                      id: 'property-1',
                      package_id: 'pkg-1',
                      module_id: 'module-1',
                      parent_id: 'class-1',
                      name: 'state',
                      created_at: '2024-01-01T00:00:00.000Z',
                      type: 'string',
                      is_static: false,
                      is_readonly: false,
                      visibility: 'private',
                    },
                  ],
                },
              },
              symbol_references: {
                ref: {
                  id: 'ref-1',
                  package_id: 'pkg-1',
                  module_id: 'module-1',
                  created_at: '2024-01-01T00:00:00.000Z',
                  source_symbol_id: 'method-1',
                  source_symbol_type: 'method',
                  source_symbol_name: 'load',
                  target_symbol_id: 'property-1',
                  target_symbol_type: 'property',
                  target_symbol_name: 'state',
                  access_kind: 'property',
                },
              },
            },
          },
        },
      ],
    };

    const selectedNode: DependencyNode = {
      id: 'module-1',
      type: 'module',
      position: { x: 0, y: 0 },
      data: { label: 'module.ts' },
    } as DependencyNode;

    const result = buildSymbolDrilldownGraph({
      data: graphData,
      selectedNode,
      direction: 'LR',
      enabledRelationshipTypes: ['import'],
    });

    const usesEdge = result.edges.find((edge) => edge.data?.type === 'uses');
    expect(usesEdge).toBeDefined();
    expect(usesEdge?.data?.usageKind).toBe('property');
    expect(usesEdge?.hidden).toBe(false);
  });
});

describe('filterNodeChangesForFolderMode', () => {
  it('passes through all changes in folder mode (Vue Flow handles compound node movement)', () => {
    const nodes: DependencyNode[] = [
      {
        id: 'group-1',
        type: 'group',
        position: { x: 0, y: 0 },
        data: { label: 'group' },
      } as DependencyNode,
      {
        id: 'module-1',
        type: 'module',
        position: { x: 0, y: 0 },
        data: { label: 'module' },
      } as DependencyNode,
    ];

    const changes: NodeChange[] = [
      { id: 'group-1', type: 'position', position: { x: 10, y: 20 }, dragging: true } as NodeChange,
      { id: 'module-1', type: 'position', position: { x: 30, y: 40 }, dragging: true } as NodeChange,
      { id: 'module-1', type: 'dimensions', dimensions: { width: 200, height: 100 } } as NodeChange,
      { id: 'module-1', type: 'select', selected: true } as NodeChange,
    ];

    const result = filterNodeChangesForFolderMode(changes, nodes, true);

    expect(result).toHaveLength(4);
    expect(result).toEqual(changes);
  });
});
