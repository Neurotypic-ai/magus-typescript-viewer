import { MarkerType } from '@vue-flow/core';

import { getNodeStyle } from '../../theme/graphTheme';

import type { DependencyNode, GraphEdge } from '../../components/DependencyGraph/types';

export interface CollapseFolderMeta {
  childIds: string[];
  liftedEdgeCount: number;
}

export interface CollapseFolderResult {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  collapsedMeta: Map<string, CollapseFolderMeta>;
}

/**
 * Walk up the parentNode chain to find the outermost collapsed ancestor.
 * Handles nested folders: if folder A contains folder B and both are collapsed,
 * children of B map to A (the outermost).
 */
function findCollapsedAncestor(
  nodeId: string,
  parentMap: Map<string, string>,
  collapsedIds: Set<string>
): string | undefined {
  let current = nodeId;
  let collapsedAncestor: string | undefined;

  for (let parent = parentMap.get(current); parent !== undefined; parent = parentMap.get(current)) {
    if (collapsedIds.has(parent)) {
      collapsedAncestor = parent;
    }
    current = parent;
  }

  return collapsedAncestor;
}

/**
 * Collapse folder group nodes by hiding their children and lifting/deduplicating edges
 * to the folder boundary. Mirrors the edge remapping pattern from `collapseSccs`.
 */
export function collapseFolders(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  collapsedFolderIds: Set<string>
): CollapseFolderResult {
  if (collapsedFolderIds.size === 0) {
    return { nodes, edges, collapsedMeta: new Map() };
  }

  // Build parent lookup: nodeId → parentNode id
  const parentMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.parentNode) {
      parentMap.set(node.id, node.parentNode);
    }
  }

  // Map each node to its outermost collapsed ancestor (if any)
  const childToFolder = new Map<string, string>();
  const folderChildren = new Map<string, string[]>();

  // Initialize children lists for collapsed folders
  for (const folderId of collapsedFolderIds) {
    folderChildren.set(folderId, []);
  }

  for (const node of nodes) {
    if (collapsedFolderIds.has(node.id)) continue; // skip folder nodes themselves

    const ancestor = findCollapsedAncestor(node.id, parentMap, collapsedFolderIds);
    if (ancestor) {
      childToFolder.set(node.id, ancestor);
      folderChildren.get(ancestor)?.push(node.id);
    }
  }

  // Build output nodes: filter out hidden children, mark collapsed folders
  const hiddenIds = new Set(childToFolder.keys());
  const collapsedMeta = new Map<string, CollapseFolderMeta>();

  const outputNodes: DependencyNode[] = [];
  for (const node of nodes) {
    if (hiddenIds.has(node.id)) continue;

    if (collapsedFolderIds.has(node.id)) {
      const children = folderChildren.get(node.id) ?? [];
      collapsedMeta.set(node.id, { childIds: children, liftedEdgeCount: 0 });

      outputNodes.push({
        ...node,
        data: {
          ...(node.data ?? { label: node.id }),
          isCollapsed: true,
          childCount: children.length,
        },
        style: {
          ...getNodeStyle('group'),
          zIndex: 0,
          overflow: 'visible',
        },
      } as DependencyNode);
    } else {
      outputNodes.push(node);
    }
  }

  // Remap edges: same dedup pattern as collapseSccs (scc.ts:133-155)
  const edgeMap = new Map<string, GraphEdge>();
  let totalLifted = 0;

  for (const edge of edges) {
    const type = (edge.data?.type as string | undefined) ?? 'dependency';
    const mappedSource = childToFolder.get(edge.source) ?? edge.source;
    const mappedTarget = childToFolder.get(edge.target) ?? edge.target;

    // Drop intra-folder edges
    if (mappedSource === mappedTarget) continue;

    const wasRemapped = mappedSource !== edge.source || mappedTarget !== edge.target;
    if (wasRemapped) totalLifted++;

    const key = `${mappedSource}|${mappedTarget}|${type}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        ...edge,
        id: key,
        source: mappedSource,
        target: mappedTarget,
        hidden: false,
        markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed, width: 20, height: 20 },
      });
    }
  }

  // Record lifted edge counts
  for (const [folderId, meta] of collapsedMeta) {
    meta.liftedEdgeCount = totalLifted;
    collapsedMeta.set(folderId, meta);
  }

  return {
    nodes: outputNodes,
    edges: Array.from(edgeMap.values()),
    collapsedMeta,
  };
}
