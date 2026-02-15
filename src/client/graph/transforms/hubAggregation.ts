import { MarkerType } from '@vue-flow/core';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../../components/DependencyGraph/layout/edgeGeometryPolicy';
import { getEdgeStyle } from '../../theme/graphTheme';

import type { DependencyEdgeKind, DependencyNode, GraphEdge } from '../../components/DependencyGraph/types';

export interface HubAggregationOptions {
  fanInThreshold: number;
}

export interface HubMeta {
  targetId: string;
  sourceIds: string[];
  originalEdgeCount: number;
}

export interface HubAggregationResult {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  hubMeta: Map<string, HubMeta>;
}

/**
 * Aggregate high-fan-in edges through invisible hub/proxy nodes.
 * For each node with in-degree >= threshold, creates a tiny hub node and routes
 * all incoming edges through it, replacing N edges with N source→hub + 1 hub→target.
 */
export function aggregateHighFanInEdges(
  nodes: DependencyNode[],
  edges: GraphEdge[],
  options: HubAggregationOptions
): HubAggregationResult {
  const { fanInThreshold } = options;

  // Compute in-degree from visible (non-hidden) edges
  const inDegree = new Map<string, number>();
  const incomingEdges = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    if (edge.hidden) continue;

    const count = inDegree.get(edge.target) ?? 0;
    inDegree.set(edge.target, count + 1);

    const incoming = incomingEdges.get(edge.target);
    if (incoming) {
      incoming.push(edge);
    } else {
      incomingEdges.set(edge.target, [edge]);
    }
  }

  // Skip group and hub nodes as targets
  const skipTypes = new Set(['group', 'hub']);
  const nodeTypeMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.type) {
      nodeTypeMap.set(node.id, node.type);
    }
  }

  // Identify high-fan-in targets
  const hubTargets = new Set<string>();
  for (const [nodeId, degree] of inDegree) {
    if (degree >= fanInThreshold && !skipTypes.has(nodeTypeMap.get(nodeId) ?? '')) {
      hubTargets.add(nodeId);
    }
  }

  if (hubTargets.size === 0) {
    return { nodes, edges, hubMeta: new Map() };
  }

  // Build hub nodes and remap edges
  const hubNodes: DependencyNode[] = [];
  const hubMeta = new Map<string, HubMeta>();
  const remappedEdgeIds = new Set<string>();
  const newEdges: GraphEdge[] = [];

  for (const targetId of hubTargets) {
    const incoming = incomingEdges.get(targetId) ?? [];
    const hubId = `hub:${targetId}`;
    const sourceIds = incoming.map((e) => e.source);

    // Hub nodes are top-level (no parentNode) so ELK positions them at the
    // folder boundary rather than inside the folder.
    hubNodes.push({
      id: hubId,
      type: 'hub',
      position: { x: 0, y: 0 },
      data: {
        label: '',
        isHub: true,
      },
      selectable: false,
      focusable: false,
    } as DependencyNode);

    hubMeta.set(hubId, {
      targetId,
      sourceIds,
      originalEdgeCount: incoming.length,
    });

    // Remap each incoming edge: source → target becomes source → hub
    for (const edge of incoming) {
      remappedEdgeIds.add(edge.id);
      newEdges.push({
        ...edge,
        id: `${edge.source}-${hubId}-${edge.data?.type ?? 'default'}`,
        target: hubId,
      });
    }

    // Find the highest-priority edge type for the hub→target edge
    const primaryType: DependencyEdgeKind = incoming[0]?.data?.type ?? 'import';

    // Create single hub → target edge with proportional thickness
    const aggregatedWidth = Math.min(6, 1.5 + incoming.length * 0.3);
    newEdges.push({
      id: `${hubId}-${targetId}-aggregated`,
      source: hubId,
      target: targetId,
      hidden: false,
      data: {
        type: primaryType,
        hubAggregated: true,
        aggregatedCount: incoming.length,
      },
      style: {
        ...getEdgeStyle(primaryType),
        strokeWidth: aggregatedWidth,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: EDGE_MARKER_WIDTH_PX, height: EDGE_MARKER_HEIGHT_PX },
    } as GraphEdge);
  }

  // Build final edge list: keep non-remapped edges, add new hub edges
  const outputEdges: GraphEdge[] = [];
  for (const edge of edges) {
    if (!remappedEdgeIds.has(edge.id)) {
      outputEdges.push(edge);
    }
  }
  outputEdges.push(...newEdges);

  return {
    nodes: [...nodes, ...hubNodes],
    edges: outputEdges,
    hubMeta,
  };
}
