import { getNodeStyle } from '../../theme/graphTheme';

import type { DependencyKind, DependencyNode, GraphEdge } from '../../components/DependencyGraph/types';

function getPathFromNode(node: DependencyNode): string | null {
  const props = node.data?.properties;
  if (!Array.isArray(props)) return null;
  const pathProp = props.find((p) => p.name === 'path');
  return typeof pathProp?.type === 'string' ? pathProp.type : null;
}

function getDirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '';
}

/**
 * Cluster module nodes by their directory. Creates a group node per directory and re-parents modules.
 * Non-module nodes are returned unchanged.
 */
export function clusterByFolder(
  nodes: DependencyNode[],
  edges: GraphEdge[]
): { nodes: DependencyNode[]; edges: GraphEdge[] } {
  const modules = nodes.filter((n) => n.type === 'module');
  if (modules.length === 0) return { nodes, edges };

  const dirToId = new Map<string, string>();
  const dirNodes: DependencyNode[] = [];

  function ensureDirNode(dir: string): string {
    if (dirToId.has(dir)) {
      return dirToId.get(dir) ?? `dir:${dir || 'root'}`;
    }
    const id = `dir:${dir || 'root'}`;
    dirToId.set(dir, id);
    dirNodes.push({
      id,
      type: 'group' as DependencyKind,
      position: { x: 0, y: 0 },
      data: { label: dir || 'root' },
      style: { ...getNodeStyle('group') },
      expandParent: true,
    });
    return id;
  }

  const remappedNodes = nodes.map((n) => {
    if (n.type !== 'module') return n;
    const p = getPathFromNode(n);
    if (!p) return n;
    const dir = getDirname(p);
    const parentId = ensureDirNode(dir);
    return {
      ...n,
      parentNode: parentId,
      extent: 'parent',
      data: { ...(n.data ?? {}), parentId },
    };
  });

  return { nodes: [...dirNodes, ...remappedNodes], edges };
}
