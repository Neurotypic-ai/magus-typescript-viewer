import { describe, expect, it } from 'vitest';

import { buildParentMap } from '../cluster/folderMembership';
import { traverseGraph } from '../traversal';

import type { DependencyNode, GraphEdge } from '../../types';

describe('traverseGraph', () => {
  const nodes: DependencyNode[] = [
    {
      id: 'folder:core',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { label: 'core' },
    } as DependencyNode,
    {
      id: 'module:a',
      type: 'module',
      parentNode: 'folder:core',
      position: { x: 0, y: 0 },
      data: { label: 'a' },
    } as DependencyNode,
    {
      id: 'module:b',
      type: 'module',
      parentNode: 'folder:core',
      position: { x: 0, y: 0 },
      data: { label: 'b' },
    } as DependencyNode,
    {
      id: 'class:c',
      type: 'class',
      parentNode: 'module:a',
      position: { x: 0, y: 0 },
      data: { label: 'c' },
    } as DependencyNode,
  ];

  const edges: GraphEdge[] = [
    {
      id: 'import',
      source: 'module:a',
      target: 'module:b',
      hidden: false,
      data: { type: 'import' },
    } as GraphEdge,
    {
      id: 'contains',
      source: 'module:a',
      target: 'class:c',
      hidden: false,
      data: { type: 'contains' },
    } as GraphEdge,
  ];

  it('finds direct neighbors with relational default filter', () => {
    const result = traverseGraph('module:a', {
      maxDepth: 1,
      semanticNodes: nodes,
      semanticEdges: edges,
      parentMap: buildParentMap(nodes),
    });

    expect(result.nodeIds.has('module:b')).toBe(true);
    expect(result.nodeIds.has('class:c')).toBe(false);
    expect(result.outbound.has('module:b')).toBe(true);
    expect(result.containingFolders.has('folder:core')).toBe(true);
  });

  it('supports explicit edgeFilter override', () => {
    const result = traverseGraph('module:a', {
      maxDepth: 1,
      edgeFilter: new Set(['contains']),
      semanticNodes: nodes,
      semanticEdges: edges,
      parentMap: buildParentMap(nodes),
    });

    expect(result.nodeIds.has('class:c')).toBe(true);
    expect(result.nodeIds.has('module:b')).toBe(false);
  });

  it('supports multi-hop traversal', () => {
    const chainedEdges: GraphEdge[] = [
      ...edges,
      {
        id: 'import-2',
        source: 'module:b',
        target: 'module:c',
        hidden: false,
        data: { type: 'import' },
      } as GraphEdge,
    ];
    const chainedNodes: DependencyNode[] = [
      ...nodes,
      {
        id: 'module:c',
        type: 'module',
        position: { x: 0, y: 0 },
        data: { label: 'c' },
      } as DependencyNode,
    ];

    const result = traverseGraph('module:a', {
      maxDepth: 2,
      semanticNodes: chainedNodes,
      semanticEdges: chainedEdges,
      parentMap: buildParentMap(chainedNodes),
    });

    expect(result.nodeIds.has('module:c')).toBe(true);
    expect(result.depthMap.get('module:c')).toBe(2);
  });
});

