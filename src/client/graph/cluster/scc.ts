import { MarkerType } from '@vue-flow/core';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../../layout/edgeGeometryPolicy';
import { getNodeStyle } from '../../theme/graphTheme';

import type { DependencyKind } from '../../types/DependencyKind';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

interface StronglyConnectedComponent {
  id: string;
  memberIds: string[]; // module node ids
}

/**
 * Build adjacency list for module-level graph from edges of supported dependency kinds.
 */
function buildAdjacency(nodes: DependencyNode[], edges: GraphEdge[]): Map<string, string[]> {
  const moduleIds = new Set(nodes.filter((n) => n.type === 'module').map((n) => n.id));
  const adj = new Map<string, string[]>();
  moduleIds.forEach((id) => adj.set(id, []));

  edges.forEach((e) => {
    const type = (e.data?.type as string | undefined) ?? 'dependency';
    if (!['import', 'export', 'dependency'].includes(type)) return;
    if (moduleIds.has(e.source) && moduleIds.has(e.target)) {
      adj.get(e.source)?.push(e.target);
    }
  });

  return adj;
}

/**
 * Tarjan's algorithm to compute SCCs for module graph.
 */
export function computeSccs(nodes: DependencyNode[], edges: GraphEdge[]): StronglyConnectedComponent[] {
  const adj = buildAdjacency(nodes, edges);
  const indexMap = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  let index = 0;
  const result: StronglyConnectedComponent[] = [];

  function strongConnect(v: string): void {
    indexMap.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = adj.get(v) ?? [];
    neighbors.forEach((w) => {
      if (!indexMap.has(w)) {
        strongConnect(w);
        const lw = lowlink.get(w);
        const lv = lowlink.get(v);
        if (lw !== undefined && lv !== undefined) {
          lowlink.set(v, Math.min(lv, lw));
        }
      } else if (onStack.get(w)) {
        const iw = indexMap.get(w);
        const lv = lowlink.get(v);
        if (iw !== undefined && lv !== undefined) {
          lowlink.set(v, Math.min(lv, iw));
        }
      }
    });

    if (lowlink.get(v) === indexMap.get(v)) {
      const members: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w !== undefined) {
          onStack.set(w, false);
          members.push(w);
        }
      } while (w !== undefined && w !== v);

      if (members.length > 1) {
        const label = members.slice().sort().join(',');
        result.push({ id: `scc:${label}`, memberIds: members });
      }
    }
  }

  Array.from(adj.keys()).forEach((v) => {
    if (!indexMap.has(v)) strongConnect(v);
  });

  return result;
}

/**
 * Collapse SCCs into compound "group" nodes. Modules inside SCCs become children.
 * Edges within the same SCC are removed. Inter-SCC edges are redirected to group nodes.
 */
export function collapseSccs(
  nodes: DependencyNode[],
  edges: GraphEdge[]
): { nodes: DependencyNode[]; edges: GraphEdge[] } {
  const sccs = computeSccs(nodes, edges);
  if (sccs.length === 0) return { nodes, edges };

  const moduleIdToSccId = new Map<string, string>();
  sccs.forEach((scc) => {
    scc.memberIds.forEach((id) => moduleIdToSccId.set(id, scc.id));
  });

  const groupNodes: DependencyNode[] = sccs.map((scc) => ({
    id: scc.id,
    type: 'group' as DependencyKind,
    position: { x: 0, y: 0 },
    data: {
      label: 'Cycle (' + String(scc.memberIds.length) + ')',
    },
    style: {
      ...getNodeStyle('group'),
    },
    expandParent: true,
  }));

  const remappedNodes: DependencyNode[] = nodes.map((n) => {
    const sccId = moduleIdToSccId.get(n.id);
    if (!sccId) return n;
    return {
      ...n,
      parentNode: sccId,
      extent: 'parent',
      data: { ...(n.data ?? {}), parentId: sccId },
    } as DependencyNode;
  });

  const edgeMap = new Map<string, GraphEdge>();
  edges.forEach((e) => {
    const type = (e.data?.type as string | undefined) ?? 'dependency';
    const srcScc = moduleIdToSccId.get(e.source);
    const tgtScc = moduleIdToSccId.get(e.target);

    const mappedSource = srcScc ?? e.source;
    const mappedTarget = tgtScc ?? e.target;

    if (mappedSource === mappedTarget) return; // drop intra-scc edges

    const key = `${mappedSource}|${mappedTarget}|${type}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        ...e,
        id: key,
        source: mappedSource,
        target: mappedTarget,
        hidden: false,
        markerEnd: e.markerEnd ?? {
          type: MarkerType.ArrowClosed,
          width: EDGE_MARKER_WIDTH_PX,
          height: EDGE_MARKER_HEIGHT_PX,
        },
      });
    }
  });

  return {
    nodes: [...groupNodes, ...remappedNodes],
    edges: Array.from(edgeMap.values()),
  };
}
