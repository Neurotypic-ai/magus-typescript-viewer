/**
 * Shared helpers for graph view building: edge filtering, bundling, visibility.
 * Used by overview and drilldown builders.
 */

import { EDGE_KIND_PRIORITY } from './edgePriority';

import type { DependencyEdgeKind } from '../types/DependencyEdgeKind';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

export interface GraphViewData {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  semanticSnapshot?: { nodes: DependencyNode[]; edges: GraphEdge[] };
}

export function filterEdgesByNodeSet(nodes: DependencyNode[], edges: GraphEdge[]): GraphEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

/**
 * Bundle parallel edges (same source → same target) into a single representative edge.
 * Reduces DOM element count by 20-40% in graphs with multiple relationship types.
 * Skips bundling for small graphs where the overhead isn't worth it.
 */
export function bundleParallelEdges(edges: GraphEdge[]): GraphEdge[] {
  if (edges.length < 50) return edges;

  const edgeGroups = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const key = `${edge.source}\0${edge.target}`;
    const group = edgeGroups.get(key);
    if (group) {
      group.push(edge);
    } else {
      edgeGroups.set(key, [edge]);
    }
  }

  const result: GraphEdge[] = [];

  for (const group of edgeGroups.values()) {
    if (group.length === 1) {
      const sole = group[0];
      if (sole) result.push(sole);
      continue;
    }

    if (group.some((edge) => edge.data?.highwaySegment === 'highway')) {
      result.push(...group);
      continue;
    }

    group.sort((a, b) => {
      const typeA = a.data?.type;
      const typeB = b.data?.type;
      const prioA = typeA ? EDGE_KIND_PRIORITY[typeA] : 0;
      const prioB = typeB ? EDGE_KIND_PRIORITY[typeB] : 0;
      return prioB - prioA;
    });

    const representative = group[0];
    if (!representative) continue;
    const bundledTypes = [
      ...new Set(group.map((e) => e.data?.type).filter((t): t is DependencyEdgeKind => t !== undefined)),
    ];
    const anyVisible = group.some((e) => !e.hidden);

    result.push({
      ...representative,
      hidden: !anyVisible,
      data: {
        ...representative.data,
        bundledCount: group.length,
        bundledTypes,
      },
    });
  }

  return result;
}

export function applyEdgeVisibility(edges: GraphEdge[], enabledRelationshipTypes: string[]): GraphEdge[] {
  const enabledTypes = new Set(enabledRelationshipTypes);

  return edges.map((edge) => {
    const type = edge.data?.type;
    if (type === 'uses' || type === 'contains') {
      return { ...edge, hidden: false };
    }
    if (!type) {
      return { ...edge, hidden: false };
    }
    return {
      ...edge,
      hidden: !enabledTypes.has(type),
    };
  });
}
