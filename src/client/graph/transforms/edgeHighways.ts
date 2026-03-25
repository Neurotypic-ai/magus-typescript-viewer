import { consola } from 'consola';

import { GROUP_ENTRY_STUB_PX } from '../../layout/edgeGeometryPolicy';
import { getEdgeStyle } from '../../theme/graphTheme';
import { createEdgeMarker } from '../../utils/edgeMarkers';
import { buildNodeToFolderMap } from '../cluster/folderMembership';
import { EDGE_KIND_PRIORITY } from '../edgePriority';
import { isValidEdgeConnection } from '../edgeTypeRegistry';
import { FOLDER_HANDLE_IDS, FOLDER_INNER_HANDLE_IDS } from '../handleRouting';

import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../../shared/types/graph/DependencyKind';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

const EDGE_REGISTRY_DEBUG =
  import.meta.env.DEV && (import.meta.env['VITE_DEBUG_EDGE_REGISTRY'] as string | undefined) === 'true';
const EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT = 5;
const edgeHighwaysLogger = consola.withTag('EdgeHighways');

interface EdgeHighwayResult {
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

const CONNECTOR_SMOOTHSTEP_PATH_OPTIONS = { offset: GROUP_ENTRY_STUB_PX, borderRadius: 0 };

export function applyEdgeHighways(
  nodes: DependencyNode[],
  edges: GraphEdge[]
): EdgeHighwayResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeToFolder = buildNodeToFolderMap(nodes);

  const keptEdges: GraphEdge[] = [];
  const exitAcc = new Map<string, SegmentAccumulator>();
  const entryAcc = new Map<string, SegmentAccumulator>();
  const trunkAcc = new Map<string, SegmentAccumulator>();
  let invalidEdgeRegistryCount = 0;
  const invalidEdgeRegistrySamples: {
    edgeId: string;
    type: string;
    source: string;
    sourceKind: DependencyKind;
    target: string;
    targetKind: DependencyKind;
  }[] = [];

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
      if (EDGE_REGISTRY_DEBUG) {
        invalidEdgeRegistryCount += 1;
        if (invalidEdgeRegistrySamples.length < EDGE_REGISTRY_DEBUG_SAMPLE_LIMIT) {
          invalidEdgeRegistrySamples.push({
            edgeId: edge.id,
            type,
            source: edge.source,
            sourceKind,
            target: edge.target,
            targetKind,
          });
        }
      }
      keptEdges.push(edge);
      continue;
    }

    addToAccumulator(exitAcc, `${edge.source}|${sourceFolder}|${targetFolder}`, type);
    addToAccumulator(entryAcc, `${sourceFolder}|${targetFolder}|${edge.target}`, type);
    addToAccumulator(trunkAcc, `${sourceFolder}|${targetFolder}`, type);
  }

  if (EDGE_REGISTRY_DEBUG && invalidEdgeRegistryCount > 0) {
    edgeHighwaysLogger.warn(
      'Skipped ' + String(invalidEdgeRegistryCount) + ' edge(s) with invalid type/source/target kind combinations.',
      { sample: invalidEdgeRegistrySamples }
    );
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
      targetHandle: FOLDER_HANDLE_IDS.rightOut,
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
      sourceHandle: FOLDER_HANDLE_IDS.rightOut,
      targetHandle: FOLDER_HANDLE_IDS.leftIn,
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
      sourceHandle: FOLDER_HANDLE_IDS.leftIn,
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

export function optimizeHighwayHandleRouting(_nodes: DependencyNode[], edges: GraphEdge[]): GraphEdge[] {
  let changed = false;

  const nextEdges = edges.map((edge) => {
    const segment = edge.data?.highwaySegment;
    if (segment === 'exit') {
      const wantSource = 'relational-out';
      const wantTarget = FOLDER_INNER_HANDLE_IDS.rightOut;
      const needsUpdate =
        edge.sourceHandle !== wantSource ||
        edge.targetHandle !== wantTarget ||
        edge.type !== 'smoothstep';
      if (!needsUpdate) return edge;
      changed = true;
      return {
        ...edge,
        type: 'smoothstep' as const,
        sourceHandle: wantSource,
        targetHandle: wantTarget,
        pathOptions: CONNECTOR_SMOOTHSTEP_PATH_OPTIONS,
      };
    }

    if (segment === 'entry') {
      const wantSource = FOLDER_INNER_HANDLE_IDS.leftIn;
      const wantTarget = 'relational-in';
      const needsUpdate =
        edge.sourceHandle !== wantSource ||
        edge.targetHandle !== wantTarget ||
        edge.type !== 'smoothstep';
      if (!needsUpdate) return edge;
      changed = true;
      return {
        ...edge,
        type: 'smoothstep' as const,
        sourceHandle: wantSource,
        targetHandle: wantTarget,
        pathOptions: CONNECTOR_SMOOTHSTEP_PATH_OPTIONS,
      };
    }

    if (segment === 'highway') {
      const wantSource = 'folder-right-out';
      const wantTarget = 'folder-left-in';
      if (edge.sourceHandle === wantSource && edge.targetHandle === wantTarget) return edge;
      changed = true;
      return { ...edge, sourceHandle: wantSource, targetHandle: wantTarget };
    }

    return edge;
  });

  return changed ? nextEdges : edges; /* eslint-disable-line @typescript-eslint/no-unnecessary-condition */
}
