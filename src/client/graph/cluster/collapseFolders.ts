import { MarkerType } from '@vue-flow/core';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../../layout/edgeGeometryPolicy';
import { getNodeStyle } from '../../theme/graphTheme';
import { buildParentMap, findCollapsedAncestor } from './folderMembership';

import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

export interface CollapseFolderMeta {
  childIds: string[];
  liftedEdgeCount: number;
}

export interface CollapseFolderResult {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  collapsedMeta: Map<string, CollapseFolderMeta>;
}

export { buildParentMap };

export function buildChildToFolderMap(
  nodes: DependencyNode[],
  collapsedFolderIds: Set<string>
): Map<string, string> {
  const parentMap = buildParentMap(nodes);
  const childToFolder = new Map<string, string>();

  for (const node of nodes) {
    if (collapsedFolderIds.has(node.id)) continue;
    const ancestor = findCollapsedAncestor(node.id, parentMap, collapsedFolderIds);
    if (ancestor) {
      childToFolder.set(node.id, ancestor);
    }
  }

  return childToFolder;
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

  // Map each node to its outermost collapsed ancestor (if any)
  const childToFolder = buildChildToFolderMap(nodes, collapsedFolderIds);
  const folderChildren = new Map<string, string[]>();

  // Initialize children lists for collapsed folders
  for (const folderId of collapsedFolderIds) {
    folderChildren.set(folderId, []);
  }

  for (const [nodeId, ancestor] of childToFolder.entries()) {
    if (collapsedFolderIds.has(nodeId)) continue;
    folderChildren.get(ancestor)?.push(nodeId);
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

    // Highway entry/exit edges become invalid when collapse remaps one endpoint.
    // Keep trunks, but drop remapped connectors so collapsed folders show only trunk paths.
    const segment = edge.data?.highwaySegment;
    if ((segment === 'exit' || segment === 'entry') && (mappedSource !== edge.source || mappedTarget !== edge.target)) {
      continue;
    }

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
        sourceHandle: mappedSource === edge.source ? (edge.sourceHandle ?? null) : null,
        targetHandle: mappedTarget === edge.target ? (edge.targetHandle ?? null) : null,
        hidden: false,
        markerEnd: edge.markerEnd ?? {
          type: MarkerType.ArrowClosed,
          width: EDGE_MARKER_WIDTH_PX,
          height: EDGE_MARKER_HEIGHT_PX,
        },
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
