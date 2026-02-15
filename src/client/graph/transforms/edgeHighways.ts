import { MarkerType } from '@vue-flow/core';

import { isValidEdgeConnection } from '../edgeTypeRegistry';
import { selectFolderHandle } from '../handleRouting';
import { buildNodeToFolderMap } from '../cluster/folderMembership';
import { getEdgeStyle } from '../../theme/graphTheme';

import type {
  DependencyEdgeKind,
  DependencyKind,
  DependencyNode,
  GraphEdge,
} from '../../components/DependencyGraph/types';

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

const EDGE_KIND_PRIORITY: Record<DependencyEdgeKind, number> = {
  contains: 5,
  uses: 5,
  inheritance: 4,
  implements: 3,
  extends: 3,
  dependency: 2,
  import: 1,
  devDependency: 0,
  peerDependency: 0,
  export: 0,
};

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

const getPrimaryEdgeType = (
  breakdown: Partial<Record<DependencyEdgeKind, number>>
): DependencyEdgeKind => {
  let best: DependencyEdgeKind = 'import';
  let bestCount = -1;
  let bestPriority = -1;

  (Object.keys(breakdown) as DependencyEdgeKind[]).forEach((kind) => {
    const count = breakdown[kind] ?? 0;
    const priority = EDGE_KIND_PRIORITY[kind] ?? 0;
    if (count > bestCount || (count === bestCount && priority > bestPriority)) {
      best = kind;
      bestCount = count;
      bestPriority = priority;
    }
  });

  return best;
};

const createMarker = () => ({ type: MarkerType.ArrowClosed, width: 12, height: 12 });

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

    addToAccumulator(exitAcc, `${edge.source}|${sourceFolder}`, type);
    addToAccumulator(entryAcc, `${targetFolder}|${edge.target}`, type);
    addToAccumulator(trunkAcc, `${sourceFolder}|${targetFolder}`, type);
  }

  const projectedEdges: GraphEdge[] = [...keptEdges];

  for (const [key, acc] of exitAcc) {
    const [sourceNodeId, folderId] = key.split('|');
    const primaryType = getPrimaryEdgeType(acc.typeBreakdown);
    projectedEdges.push({
      id: `highway-exit:${sourceNodeId}|${folderId}`,
      source: sourceNodeId!,
      target: folderId!,
      targetHandle: selectFolderHandle(options.direction, 'outgoing'),
      hidden: false,
      data: {
        type: primaryType,
        highwaySegment: 'exit',
        highwayCount: acc.count,
        highwayTypeBreakdown: acc.typeBreakdown,
      },
      style: {
        ...getEdgeStyle(primaryType),
        strokeWidth: Math.min(3, 1 + acc.count * 0.2),
      },
      markerEnd: createMarker(),
    } as GraphEdge);
  }

  for (const [key, acc] of trunkAcc) {
    const [sourceFolder, targetFolder] = key.split('|');
    const primaryType = getPrimaryEdgeType(acc.typeBreakdown);
    const highwayTypes = (Object.keys(acc.typeBreakdown) as DependencyEdgeKind[]).filter(
      (kind) => (acc.typeBreakdown[kind] ?? 0) > 0
    );
    projectedEdges.push({
      id: `highway-trunk:${sourceFolder}|${targetFolder}`,
      source: sourceFolder!,
      target: targetFolder!,
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
      markerEnd: createMarker(),
    } as GraphEdge);
  }

  for (const [key, acc] of entryAcc) {
    const [folderId, targetNodeId] = key.split('|');
    const primaryType = getPrimaryEdgeType(acc.typeBreakdown);
    projectedEdges.push({
      id: `highway-entry:${folderId}|${targetNodeId}`,
      source: folderId!,
      target: targetNodeId!,
      sourceHandle: selectFolderHandle(options.direction, 'incoming'),
      hidden: false,
      data: {
        type: primaryType,
        highwaySegment: 'entry',
        highwayCount: acc.count,
        highwayTypeBreakdown: acc.typeBreakdown,
      },
      style: {
        ...getEdgeStyle(primaryType),
        strokeWidth: Math.min(3, 1 + acc.count * 0.2),
      },
      markerEnd: createMarker(),
    } as GraphEdge);
  }

  return {
    nodes,
    edges: projectedEdges,
  };
}

