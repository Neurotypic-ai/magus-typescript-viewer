import { describe, expect, it } from 'vitest';

import { applyEdgeVisibility, buildOverviewGraph, buildSymbolDrilldownGraph, filterNodeChangesForFolderMode } from '../graph/buildGraphView';

import type { NodeChange } from '@vue-flow/core';

import type { DependencyNode, DependencyPackageGraph, GraphEdge } from '../types';

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
    const data: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg',
          version: '1.0.0',
          path: '/pkg',
          created_at: '2024-01-01T00:00:00.000Z',
          modules: {
            m1: {
              id: 'module-main',
              name: 'main.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/main.ts' },
              imports: {},
            },
            m2: {
              id: 'module-test',
              name: 'main.test.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/main.test.ts' },
              imports: {},
            },
          },
        },
      ],
    };

    const result = buildOverviewGraph({
      data,
      enabledNodeTypes: ['module'],
      enabledRelationshipTypes: ['import'],
      direction: 'LR',
      clusterByFolder: false,
      collapseScc: false,
      collapsedFolderIds: new Set(),
      hideTestFiles: true,
      memberNodeMode: 'compact',
      highlightOrphanGlobal: true,
    });

    expect(result.nodes.some((node) => node.id === 'module-test')).toBe(false);
    const mainNode = result.nodes.find((node) => node.id === 'module-main');
    expect(mainNode?.data?.diagnostics?.orphanCurrent).toBe(true);
    expect(mainNode?.data?.diagnostics?.orphanGlobal).toBe(true);
  });

  it('returns a semantic snapshot and projects folder highways in folder mode', () => {
    const data: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg',
          version: '1.0.0',
          path: '/pkg',
          created_at: '2024-01-01T00:00:00.000Z',
          modules: {
            a: {
              id: 'module-a',
              name: 'a.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/a/a.ts' },
              imports: {
                i1: {
                  uuid: 'i1',
                  name: 'b',
                  path: '../b/b',
                },
              },
            },
            b: {
              id: 'module-b',
              name: 'b.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/b/b.ts' },
              imports: {},
            },
          },
        },
      ],
    };

    const result = buildOverviewGraph({
      data,
      enabledNodeTypes: ['module'],
      enabledRelationshipTypes: ['import'],
      direction: 'LR',
      clusterByFolder: true,
      collapseScc: false,
      collapsedFolderIds: new Set(),
      hideTestFiles: false,
      memberNodeMode: 'compact',
      highlightOrphanGlobal: false,
    });

    expect(result.semanticSnapshot).toBeDefined();
    expect(result.semanticSnapshot?.nodes.some((node) => node.type === 'group')).toBe(false);
    expect(result.edges.some((edge) => edge.data?.highwaySegment === 'highway')).toBe(true);
  });
});

describe('buildSymbolDrilldownGraph', () => {
  it('creates uses edges with usageKind metadata from module symbol references', () => {
    const graphData: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-1',
          name: 'pkg',
          version: '1.0.0',
          path: '/pkg',
          created_at: '2024-01-01T00:00:00.000Z',
          modules: {
            mod: {
              id: 'module-1',
              name: 'module.ts',
              package_id: 'pkg-1',
              source: { relativePath: 'src/module.ts' },
              classes: {
                Service: {
                  id: 'class-1',
                  name: 'Service',
                  methods: [
                    {
                      id: 'method-1',
                      name: 'load',
                      returnType: 'void',
                      visibility: 'public',
                      signature: 'load(): void',
                    },
                  ],
                  properties: [
                    {
                      id: 'property-1',
                      name: 'state',
                      type: 'string',
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
