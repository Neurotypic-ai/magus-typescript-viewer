import { describe, expect, it } from 'vitest';

import { clusterByFolder } from '../folders';

import type { DependencyNode, GraphEdge } from '../../../components/DependencyGraph/types';

function createModuleNode(id: string, relativePath: string, pkg = 'app'): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      properties: [
        { name: 'package', type: pkg, visibility: 'public' },
        { name: 'path', type: relativePath, visibility: 'public' },
      ],
    },
  } as DependencyNode;
}

describe('clusterByFolder', () => {
  it('creates group nodes and reparents module nodes by directory', () => {
    const nodes: DependencyNode[] = [
      createModuleNode('m1', 'src/core/a.ts'),
      createModuleNode('m2', 'src/core/b.ts'),
      createModuleNode('m3', 'src/ui/c.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = clusterByFolder(nodes, edges);
    const groupNodes = result.nodes.filter((node) => node.type === 'group');
    const moduleNodes = result.nodes.filter((node) => node.type === 'module');

    expect(groupNodes).toHaveLength(2);
    expect(moduleNodes).toHaveLength(3);
    expect(moduleNodes.every((node) => typeof node.parentNode === 'string')).toBe(true);
    expect(moduleNodes.every((node) => (node as { extent?: string }).extent === undefined)).toBe(true);
  });

  it('is deterministic for identical input', () => {
    const baseNodes: DependencyNode[] = [
      createModuleNode('m1', 'src/core/a.ts'),
      createModuleNode('m2', 'src/core/b.ts'),
      createModuleNode('m3', 'src/ui/c.ts'),
    ];
    const baseEdges: GraphEdge[] = [
      {
        id: 'e1',
        source: 'm1',
        target: 'm2',
        hidden: false,
        data: { type: 'import' },
      } as GraphEdge,
    ];

    const first = clusterByFolder(
      JSON.parse(JSON.stringify(baseNodes)) as DependencyNode[],
      JSON.parse(JSON.stringify(baseEdges)) as GraphEdge[]
    );
    const second = clusterByFolder(
      JSON.parse(JSON.stringify(baseNodes)) as DependencyNode[],
      JSON.parse(JSON.stringify(baseEdges)) as GraphEdge[]
    );

    expect(first).toEqual(second);
  });
});
describe('clusterByFolder', () => {
  it('keeps folders distinct across packages', () => {
    const nodes: DependencyNode[] = [
      createModuleNode('module-a', 'src/index.ts', 'package-a'),
      createModuleNode('module-b', 'src/index.ts', 'package-b'),
    ];
    const edges: GraphEdge[] = [];

    const result = clusterByFolder(nodes, edges);
    const groupNodes = result.nodes.filter((n) => n.type === 'group');

    expect(groupNodes).toHaveLength(2);

    const moduleA = result.nodes.find((n) => n.id === 'module-a');
    const moduleB = result.nodes.find((n) => n.id === 'module-b');
    expect(moduleA?.parentNode).toBeDefined();
    expect(moduleB?.parentNode).toBeDefined();
    expect(moduleA?.parentNode).not.toBe(moduleB?.parentNode);
  });
});
