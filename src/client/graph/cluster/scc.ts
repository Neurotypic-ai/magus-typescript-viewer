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


