import { describe, expect, it } from 'vitest';

import { clusterByFolder } from '../folders';

import type { DependencyNode, GraphEdge } from '../../../components/DependencyGraph/types';

function createModuleNode(id: string, pkg: string, path: string): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      properties: [
        { name: 'package', type: pkg, visibility: 'public' },
        { name: 'path', type: path, visibility: 'public' },
      ],
    },
  } as DependencyNode;
}

describe('clusterByFolder', () => {
  it('keeps folders distinct across packages', () => {
    const nodes: DependencyNode[] = [
      createModuleNode('module-a', 'package-a', 'src/index.ts'),
      createModuleNode('module-b', 'package-b', 'src/index.ts'),
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
