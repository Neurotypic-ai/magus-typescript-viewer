import { type EdgeHandleSide, GROUP_ENTRY_STUB_PX, getHandleSide } from '../../layout/edgeGeometryPolicy';
import { buildAbsoluteNodeBoundsMap, getBoundsCenter } from '../../layout/geometryBounds';
import { getEdgeStyle } from '../../theme/graphTheme';
import { createEdgeMarker } from '../../utils/edgeMarkers';
import { getHandleAnchor } from '../../layout/handleAnchors';
import { buildNodeToFolderMap } from '../cluster/folderMembership';
import { EDGE_KIND_PRIORITY } from '../edgePriority';
import { isValidEdgeConnection } from '../edgeTypeRegistry';
import { FOLDER_HANDLE_IDS, FOLDER_INNER_HANDLE_IDS, selectFolderHandle } from '../handleRouting';

import type { Rect } from '../../layout/geometryBounds';
import type { DependencyEdgeKind, DependencyKind, DependencyNode, GraphEdge } from '../../types';

export interface EdgeHighwayOptions {
  direction: 'LR' | 'RL' | 'TB' | 'BT';
}

export interface EdgeHighwayResult {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

interface SegmentAccumulator {
  count: number;
  typeBreakdown: Partial<Record<DependencyEdgeKind, number>>;
}

const addToAccumulator = (
  accumulator: Map<string, SegmentAccumulator>,
  key: string,
  edgeKind: DependencyEdgeKind | undefined
): void => {
  const current = accumulator.get(key) ?? { count: 0, typeBreakdown: {} };
  current.count += 1;
  if (edgeKind) {
    current.typeBreakdown[edgeKind] = (current.typeBreakdown[edgeKind] ?? 0) + 1;
  }
  accumulator.set(key, current);
};

const getPrimaryEdgeType = (breakdown: Partial<Record<DependencyEdgeKind, number>>): DependencyEdgeKind => {
  let best: DependencyEdgeKind = 'import';
  let bestCount = -1;
  let bestPriority = -1;

  (Object.keys(breakdown) as DependencyEdgeKind[]).forEach((kind) => {
    const count = breakdown[kind] ?? 0;
    const priority = EDGE_KIND_PRIORITY[kind];
    if (count > bestCount || (count === bestCount && priority > bestPriority)) {
      best = kind;
      bestCount = count;
      bestPriority = priority;
    }
  });

  return best;
};

const HIGHWAY_DEFAULT_NODE_WIDTH = 260;
const HIGHWAY_DEFAULT_NODE_HEIGHT = 100;

const OUTGOING_HANDLE_IDS = [
  FOLDER_HANDLE_IDS.topOut,
  FOLDER_HANDLE_IDS.rightOut,
  FOLDER_HANDLE_IDS.bottomOut,
  FOLDER_HANDLE_IDS.leftOut,
] as const;

const INCOMING_HANDLE_IDS = [
  FOLDER_HANDLE_IDS.topIn,
  FOLDER_HANDLE_IDS.rightIn,
  FOLDER_HANDLE_IDS.bottomIn,
  FOLDER_HANDLE_IDS.leftIn,
] as const;
const CONNECTOR_SMOOTHSTEP_PATH_OPTIONS = { offset: GROUP_ENTRY_STUB_PX, borderRadius: 0 };
const CHILD_OUT_HANDLE_BY_SIDE: Record<EdgeHandleSide, string> = {
  top: 'relational-out-top',
  right: 'relational-out-right',
  bottom: 'relational-out-bottom',
  left: 'relational-out-left',
};
const CHILD_IN_HANDLE_BY_SIDE: Record<EdgeHandleSide, string> = {
  top: 'relational-in-top',
  right: 'relational-in-right',
  bottom: 'relational-in-bottom',
  left: 'relational-in-left',
};
const FOLDER_INNER_OUT_HANDLE_BY_SIDE: Record<EdgeHandleSide, string> = {
  top: FOLDER_INNER_HANDLE_IDS.topOut,
  right: FOLDER_INNER_HANDLE_IDS.rightOut,
  bottom: FOLDER_INNER_HANDLE_IDS.bottomOut,
  left: FOLDER_INNER_HANDLE_IDS.leftOut,
};
const FOLDER_INNER_IN_HANDLE_BY_SIDE: Record<EdgeHandleSide, string> = {
  top: FOLDER_INNER_HANDLE_IDS.topIn,
  right: FOLDER_INNER_HANDLE_IDS.rightIn,
  bottom: FOLDER_INNER_HANDLE_IDS.bottomIn,
  left: FOLDER_INNER_HANDLE_IDS.leftIn,
};

/**
 * Build highway-local absolute bounds map using shared geometry helper.
 * DependencyNode is compatible with BoundsNode thanks to matching shape.
 */
function buildHighwayAbsoluteNodeBoundsMap(nodes: DependencyNode[]): Map<string, Rect> {
  return buildAbsoluteNodeBoundsMap(nodes, {
    defaultNodeWidth: HIGHWAY_DEFAULT_NODE_WIDTH,
    defaultNodeHeight: HIGHWAY_DEFAULT_NODE_HEIGHT,
  });
}

const chooseClosestHandle = (
  folderBounds: { x: number; y: number; width: number; height: number } | undefined,
  targetPoint: { x: number; y: number } | undefined,
  candidateHandles: readonly string[],
  fallbackHandle: string
): string => {
  if (!folderBounds || !targetPoint) {
    return fallbackHandle;
  }

  let bestHandle = fallbackHandle;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidateHandles.forEach((handleId) => {
    const handlePoint = getHandleAnchor(folderBounds, handleId);
    if (!handlePoint) return;
    const dx = handlePoint.x - targetPoint.x;
    const dy = handlePoint.y - targetPoint.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistance) {
      bestDistance = distanceSq;
      bestHandle = handleId;
    }
  });

  return bestHandle;
};


export function applyEdgeHighways(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  options: EdgeHighwayOptions
): EdgeHighwayResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeToFolder = buildNodeToFolderMap(nodes);

  const keptEdges: GraphEdge[] = [];
  const exitAcc = new Map<string, SegmentAccumulator>();
  const entryAcc = new Map<string, SegmentAccumulator>();
  const trunkAcc = new Map<string, SegmentAccumulator>();

  for (const edge of edges) {
    const sourceFolder = nodeToFolder.get(edge.source);
    const targetFolder = nodeToFolder.get(edge.target);

    if (!sourceFolder || !targetFolder || sourceFolder === targetFolder) {
      keptEdges.push(edge);
      continue;
    }

    const type = edge.data?.type;
    const sourceKind = nodeById.get(edge.source)?.type as DependencyKind | undefined;
    const targetKind = nodeById.get(edge.target)?.type as DependencyKind | undefined;
    if (type && sourceKind && targetKind && !isValidEdgeConnection(type, sourceKind, targetKind)) {
      if (import.meta.env.DEV) {
        console.warn('[edgeHighways] Skipping highway projection for invalid typed edge', {
          edgeId: edge.id,
          type,
          source: edge.source,
          sourceKind,
          target: edge.target,
          targetKind,
        });
      }
      keptEdges.push(edge);
      continue;
    }

    addToAccumulator(exitAcc, `${edge.source}|${sourceFolder}|${targetFolder}`, type);
    addToAccumulator(entryAcc, `${sourceFolder}|${targetFolder}|${edge.target}`, type);
    addToAccumulator(trunkAcc, `${sourceFolder}|${targetFolder}`, type);
  }

  const projectedEdges: GraphEdge[] = [...keptEdges];

  for (const [key, acc] of exitAcc) {
    const parts = key.split('|');
    const sourceNodeId = parts[0] ?? '';
    const folderId = parts[1] ?? '';
    const peerFolderId = parts[2] ?? '';
    const primaryType = getPrimaryEdgeType(acc.typeBreakdown);
    projectedEdges.push({
      id: `highway-exit:${sourceNodeId}|${folderId}|${peerFolderId}`,
      source: sourceNodeId,
      target: folderId,
      targetHandle: selectFolderHandle(options.direction, 'outgoing'),
      hidden: false,
      data: {
        type: primaryType,
        highwaySegment: 'exit',
        highwayCount: acc.count,
        highwayGroupId: `${folderId}|${peerFolderId}`,
        highwayTypeBreakdown: acc.typeBreakdown,
      },
      style: {
        ...getEdgeStyle(primaryType),
        strokeWidth: Math.min(3, 1 + acc.count * 0.2),
      },
    } as GraphEdge);
  }

  for (const [key, acc] of trunkAcc) {
    const trunkParts = key.split('|');
    const sourceFolder = trunkParts[0] ?? '';
    const targetFolder = trunkParts[1] ?? '';
    const primaryType = getPrimaryEdgeType(acc.typeBreakdown);
    const highwayTypes = (Object.keys(acc.typeBreakdown) as DependencyEdgeKind[]).filter(
      (kind) => (acc.typeBreakdown[kind] ?? 0) > 0
    );
    projectedEdges.push({
      id: `highway-trunk:${sourceFolder}|${targetFolder}`,
      source: sourceFolder,
      target: targetFolder,
      sourceHandle: selectFolderHandle(options.direction, 'outgoing'),
      targetHandle: selectFolderHandle(options.direction, 'incoming'),
      hidden: false,
      data: {
        type: primaryType,
        highwaySegment: 'highway',
        highwayCount: acc.count,
        highwayTypes,
        highwayGroupId: `${sourceFolder}|${targetFolder}`,
        highwayTypeBreakdown: acc.typeBreakdown,
      },
      style: {
        ...getEdgeStyle(primaryType),
        strokeWidth: Math.min(8, 1.5 + acc.count * 0.4),
      },
      markerEnd: createEdgeMarker(),
    } as GraphEdge);
  }

  for (const [key, acc] of entryAcc) {
    const entryParts = key.split('|');
    const peerFolderId = entryParts[0] ?? '';
    const folderId = entryParts[1] ?? '';
    const targetNodeId = entryParts[2] ?? '';
    const primaryType = getPrimaryEdgeType(acc.typeBreakdown);
    projectedEdges.push({
      id: `highway-entry:${peerFolderId}|${folderId}|${targetNodeId}`,
      source: folderId,
      target: targetNodeId,
      sourceHandle: selectFolderHandle(options.direction, 'incoming'),
      hidden: false,
      data: {
        type: primaryType,
        highwaySegment: 'entry',
        highwayCount: acc.count,
        highwayGroupId: `${peerFolderId}|${folderId}`,
        highwayTypeBreakdown: acc.typeBreakdown,
      },
      style: {
        ...getEdgeStyle(primaryType),
        strokeWidth: Math.min(3, 1 + acc.count * 0.2),
      },
    } as GraphEdge);
  }

  return {
    nodes,
    edges: projectedEdges,
  };
}

export function optimizeHighwayHandleRouting(nodes: DependencyNode[], edges: GraphEdge[]): GraphEdge[] {
  const boundsById = buildHighwayAbsoluteNodeBoundsMap(nodes);
  let changed = false;

  const nextEdges = edges.map((edge) => {
    const segment = edge.data?.highwaySegment;
    if (segment !== 'exit' && segment !== 'entry' && segment !== 'highway') {
      return edge;
    }

    if (segment === 'exit') {
      const sourceBounds = boundsById.get(edge.source);
      const sourceCenter = sourceBounds ? getBoundsCenter(sourceBounds) : undefined;
      const targetBounds = boundsById.get(edge.target);
      const groupId = edge.data?.highwayGroupId;
      const peerFolderId = typeof groupId === 'string' && groupId.includes('|') ? groupId.split('|')[1] : undefined;
      const peerFolderBounds = peerFolderId ? boundsById.get(peerFolderId) : undefined;
      const routingTarget = peerFolderBounds ? getBoundsCenter(peerFolderBounds) : sourceCenter;
      const targetHandle = chooseClosestHandle(
        targetBounds,
        routingTarget,
        OUTGOING_HANDLE_IDS,
        edge.targetHandle ?? FOLDER_HANDLE_IDS.rightOut
      );
      const side = getHandleSide(targetHandle) ?? 'right';
      const sourceHandle = CHILD_OUT_HANDLE_BY_SIDE[side];
      const innerTargetHandle = FOLDER_INNER_OUT_HANDLE_BY_SIDE[side];
      const pathOptions = edge.pathOptions as { offset?: number; borderRadius?: number } | undefined;
      const requiresPathTuning =
        edge.type !== 'smoothstep' ||
        pathOptions?.offset !== CONNECTOR_SMOOTHSTEP_PATH_OPTIONS.offset ||
        pathOptions.borderRadius !== CONNECTOR_SMOOTHSTEP_PATH_OPTIONS.borderRadius;
      if (innerTargetHandle !== edge.targetHandle || sourceHandle !== edge.sourceHandle || requiresPathTuning) {
        changed = true;
        return {
          ...edge,
          type: 'smoothstep',
          sourceHandle,
          targetHandle: innerTargetHandle,
          pathOptions: CONNECTOR_SMOOTHSTEP_PATH_OPTIONS,
        };
      }
      return edge;
    }

    if (segment === 'entry') {
      const targetBounds = boundsById.get(edge.target);
      const targetCenter = targetBounds ? getBoundsCenter(targetBounds) : undefined;
      const sourceBounds = boundsById.get(edge.source);
      const sourceHandle = chooseClosestHandle(
        sourceBounds,
        targetCenter,
        INCOMING_HANDLE_IDS,
        edge.sourceHandle ?? FOLDER_HANDLE_IDS.leftIn
      );
      const side = getHandleSide(sourceHandle) ?? 'left';
      const targetHandle = CHILD_IN_HANDLE_BY_SIDE[side];
      const innerSourceHandle = FOLDER_INNER_IN_HANDLE_BY_SIDE[side];
      const pathOptionsEntry = edge.pathOptions as { offset?: number; borderRadius?: number } | undefined;
      const requiresPathTuningEntry =
        edge.type !== 'smoothstep' ||
        pathOptionsEntry?.offset !== CONNECTOR_SMOOTHSTEP_PATH_OPTIONS.offset ||
        pathOptionsEntry.borderRadius !== CONNECTOR_SMOOTHSTEP_PATH_OPTIONS.borderRadius;
      if (innerSourceHandle !== edge.sourceHandle || targetHandle !== edge.targetHandle || requiresPathTuningEntry) {
        changed = true;
        return {
          ...edge,
          type: 'smoothstep',
          sourceHandle: innerSourceHandle,
          targetHandle,
          pathOptions: CONNECTOR_SMOOTHSTEP_PATH_OPTIONS,
        };
      }
      return edge;
    }

    const sourceFolderBounds = boundsById.get(edge.source);
    const targetFolderBounds = boundsById.get(edge.target);
    const sourceFolderCenter = sourceFolderBounds ? getBoundsCenter(sourceFolderBounds) : undefined;
    const targetFolderCenter = targetFolderBounds ? getBoundsCenter(targetFolderBounds) : undefined;

    const sourceHandle = chooseClosestHandle(
      sourceFolderBounds,
      targetFolderCenter,
      OUTGOING_HANDLE_IDS,
      edge.sourceHandle ?? FOLDER_HANDLE_IDS.rightOut
    );
    const targetHandle = chooseClosestHandle(
      targetFolderBounds,
      sourceFolderCenter,
      INCOMING_HANDLE_IDS,
      edge.targetHandle ?? FOLDER_HANDLE_IDS.leftIn
    );

    if (sourceHandle !== edge.sourceHandle || targetHandle !== edge.targetHandle) {
      changed = true;
      return {
        ...edge,
        sourceHandle,
        targetHandle,
      };
    }
    return edge;
  });

  return changed ? nextEdges : edges; /* eslint-disable-line @typescript-eslint/no-unnecessary-condition */
}
