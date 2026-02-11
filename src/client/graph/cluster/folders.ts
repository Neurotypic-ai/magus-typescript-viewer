import { getNodeStyle } from '../../theme/graphTheme';

import type { DependencyKind, DependencyNode, GraphEdge } from '../../components/DependencyGraph/types';

function getPathFromNode(node: DependencyNode): string | null {
  const props = node.data?.properties;
  if (!Array.isArray(props)) return null;
  const pathProp = props.find((p) => p.name === 'path');
  return typeof pathProp?.type === 'string' ? pathProp.type : null;
}

function getPackageFromNode(node: DependencyNode): string | null {
  const props = node.data?.properties;
  if (!Array.isArray(props)) return null;
  const packageProp = props.find((p) => p.name === 'package');
  return typeof packageProp?.type === 'string' ? packageProp.type : null;
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

  function ensureDirNode(pkg: string, dir: string): string {
    const key = `${pkg}:${dir}`;
    if (dirToId.has(key)) {
      return dirToId.get(key) ?? `dir:${key || 'root'}`;
    }
    const id = `dir:${key || 'root'}`;
    dirToId.set(key, id);
    dirNodes.push({
      id,
      type: 'group' as DependencyKind,
      position: { x: 0, y: 0 },
      width: 220,
      height: 120,
      data: { label: `${pkg}/${dir || 'root'}` },
      style: {
        ...getNodeStyle('group'),
        zIndex: 0,
        overflow: 'visible',
      },
      draggable: false,
    });
    return id;
  }

  const remappedNodes = nodes.map((n) => {
    if (n.type !== 'module') return n;
    const pkg = getPackageFromNode(n);
    const p = getPathFromNode(n);
    if (!p || !pkg) return n;
    const dir = getDirname(p);
    const parentId = ensureDirNode(pkg, dir);
    const { extent: _removedExtent, ...nodeWithoutExtent } = n;
    return {
      ...nodeWithoutExtent,
      parentNode: parentId,
      expandParent: true,
      data: { ...(n.data ?? {}), parentId },
    };
  });

  return { nodes: [...dirNodes, ...remappedNodes] as DependencyNode[], edges };
}
