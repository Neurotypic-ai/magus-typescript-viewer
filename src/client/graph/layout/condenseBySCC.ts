/**
 * Tarjan strongly-connected-components (SCC) condensation.
 *
 * Replaces the ad-hoc DFS back-edge classifier (`detectBackEdges`) with a
 * canonical SCC decomposition. Every edge that closes a cycle is classified
 * as "intra-SCC" — not as a back-edge whose identity depends on DFS start
 * order. The condensed graph (supernodes + inter-SCC edges) is a genuine
 * DAG, which is what Sugiyama layering wants.
 *
 * Size-1 SCCs are called "trivial"; they are returned verbatim. Size-N SCCs
 * (N >= 2) are "non-trivial": the N members are packaged into a single
 * supernode of `type: 'scc'`, and all edges touching a member are rewritten
 * to touch the supernode. Edges whose both endpoints fall inside the same
 * SCC are dropped from the condensed graph (they live inside the supernode,
 * rendered by the SCC's internal layout).
 *
 * isBackEdge semantics: for legacy styling compatibility, every edge whose
 * id appears in `sccBackEdges` gets `isBackEdge: true` on its data. This
 * differs slightly from the old DFS-order-dependent `isBackEdge`: now
 * "back-edge" means "intra-SCC edge" — a canonical property of the graph,
 * independent of traversal order.
 *
 * The algorithm runs in O(V+E) and is implemented iteratively to avoid
 * stack overflow on large inputs. Node and adjacency ordering is sorted
 * so the output (component boundaries, supernode ids) is deterministic.
 */

import { getNodeStyle } from '../../theme/graphTheme';

import type { DependencyData } from '../../../shared/types/graph/DependencyData';
import type { DependencyKind } from '../../../shared/types/graph/DependencyKind';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

export interface SccComputationResult {
  /**
   * One list per strongly-connected component. Size-1 components are
   * trivial (singletons); size-N components are non-trivial cycles.
   * Component order is deterministic (sorted by the smallest member id).
   */
  components: string[][];
  /**
   * Edge ids that connect two members of the same non-trivial SCC.
   * These are "back-edges" under the new canonical semantics: any edge
   * participating in a cycle.
   */
  sccBackEdges: Set<string>;
}

export interface SccSupernodeMeta {
  /** The synthetic supernode's id (shape: `scc:<first-member-sorted>:<size>`). */
  id: string;
  /** Ordered list of member node ids (sorted). */
  members: string[];
}

export interface CondenseResult {
  /** Condensed node list: non-members + supernodes. */
  condensedNodes: DependencyNode[];
  /** Condensed edge list: endpoints rewritten to supernode ids, intra-SCC edges dropped. */
  condensedEdges: GraphEdge[];
  /** Metadata for every supernode created. */
  supernodes: SccSupernodeMeta[];
  /** Lookup: memberId → supernodeId (only for members of non-trivial SCCs). */
  memberToSupernode: Map<string, string>;
}

interface AdjacencyEntry {
  /** Neighbour node id. */
  target: string;
  /** The edge id that produced this adjacency entry. */
  edgeId: string;
}

// ── Tarjan core ──────────────────────────────────────────────────────────────

function buildAdjacency(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[]
): Map<string, AdjacencyEntry[]> {
  const idSet = new Set(nodeIds);
  const adj = new Map<string, AdjacencyEntry[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    adj.get(edge.source)?.push({ target: edge.target, edgeId: edge.id });
  }
  // Deterministic adjacency order: sort entries by target id, then edge id.
  for (const [, entries] of adj) {
    entries.sort((a, b) => {
      const cmp = a.target.localeCompare(b.target);
      return cmp !== 0 ? cmp : a.edgeId.localeCompare(b.edgeId);
    });
  }
  return adj;
}

/**
 * Iterative Tarjan SCC. Uses explicit frames to avoid recursion stack
 * overflow on graphs with very long chains.
 */
export function computeStronglyConnectedComponents(
  nodes: readonly DependencyNode[],
  edges: readonly GraphEdge[]
): SccComputationResult {
  // Sort node ids for deterministic traversal start order.
  const nodeIds = nodes.map((n) => n.id).sort((a, b) => a.localeCompare(b));
  const adj = buildAdjacency(nodeIds, edges);

  const indexOf = new Map<string, number>();
  const lowlinkOf = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let indexCounter = 0;
  const components: string[][] = [];

  interface Frame {
    nodeId: string;
    /** Index into adj[nodeId] for the next neighbour to explore. */
    iter: number;
    /** The last child we recursed into, so we can update lowlink on return. */
    pendingChild: string | null;
  }

  for (const startId of nodeIds) {
    if (indexOf.has(startId)) continue;

    const frames: Frame[] = [{ nodeId: startId, iter: 0, pendingChild: null }];
    indexOf.set(startId, indexCounter);
    lowlinkOf.set(startId, indexCounter);
    indexCounter += 1;
    stack.push(startId);
    onStack.add(startId);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;

      // Propagate lowlink from the child we just finished (if any).
      if (frame.pendingChild !== null) {
        const childLow = lowlinkOf.get(frame.pendingChild) ?? 0;
        const ownLow = lowlinkOf.get(frame.nodeId) ?? 0;
        lowlinkOf.set(frame.nodeId, Math.min(ownLow, childLow));
        frame.pendingChild = null;
      }

      const neighbours = adj.get(frame.nodeId) ?? [];
      let advanced = false;
      while (frame.iter < neighbours.length) {
        const nbr = neighbours[frame.iter];
        frame.iter += 1;
        if (!nbr) continue;
        const { target } = nbr;
        if (!indexOf.has(target)) {
          indexOf.set(target, indexCounter);
          lowlinkOf.set(target, indexCounter);
          indexCounter += 1;
          stack.push(target);
          onStack.add(target);
          frame.pendingChild = target;
          frames.push({ nodeId: target, iter: 0, pendingChild: null });
          advanced = true;
          break;
        }
        if (onStack.has(target)) {
          const targetIdx = indexOf.get(target) ?? 0;
          const ownLow = lowlinkOf.get(frame.nodeId) ?? 0;
          lowlinkOf.set(frame.nodeId, Math.min(ownLow, targetIdx));
        }
      }

      if (advanced) continue;

      // All neighbours processed; if this is a root, pop the SCC.
      if (indexOf.get(frame.nodeId) === lowlinkOf.get(frame.nodeId)) {
        const component: string[] = [];
        let popped: string | undefined;
        do {
          popped = stack.pop();
          if (popped === undefined) break;
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== frame.nodeId);
        component.sort((a, b) => a.localeCompare(b));
        components.push(component);
      }
      frames.pop();
    }
  }

  // Deterministic component order: sort by first member id.
  components.sort((a, b) => {
    const aFirst = a[0] ?? '';
    const bFirst = b[0] ?? '';
    return aFirst.localeCompare(bFirst);
  });

  // Collect intra-SCC edge ids (both endpoints in the same non-trivial SCC).
  const sccBackEdges = new Set<string>();
  const componentOf = new Map<string, number>();
  components.forEach((members, idx) => {
    if (members.length < 2) return;
    for (const m of members) componentOf.set(m, idx);
  });
  for (const edge of edges) {
    const srcIdx = componentOf.get(edge.source);
    const tgtIdx = componentOf.get(edge.target);
    if (srcIdx !== undefined && srcIdx === tgtIdx) {
      sccBackEdges.add(edge.id);
    }
  }

  return { components, sccBackEdges };
}

// ── Condensation ─────────────────────────────────────────────────────────────

function makeSupernodeId(members: string[]): string {
  // members is assumed sorted.
  const first = members[0] ?? '';
  return `scc:${first}:${String(members.length)}`;
}

function createSupernode(members: string[]): DependencyNode {
  const id = makeSupernodeId(members);
  const data: DependencyData = {
    label: `SCC (${String(members.length)} members)`,
    sccMembers: members,
  };
  return {
    id,
    type: 'scc' as DependencyKind,
    position: { x: 0, y: 0 },
    data,
    style: {
      ...getNodeStyle('scc' as DependencyKind),
      zIndex: 0,
      overflow: 'visible',
      padding: 0,
    },
    draggable: true,
  };
}

/**
 * Condense the graph by replacing every non-trivial SCC with a supernode.
 * Returns the condensed node/edge lists plus membership metadata so callers
 * can attach member-level state (internal layout, original edges, etc.)
 * to the supernodes.
 */
export function condenseBySCC(
  nodes: readonly DependencyNode[],
  edges: readonly GraphEdge[]
): CondenseResult {
  const { components } = computeStronglyConnectedComponents(nodes, edges);

  const supernodes: SccSupernodeMeta[] = [];
  const memberToSupernode = new Map<string, string>();
  const supernodeNodes: DependencyNode[] = [];

  for (const members of components) {
    if (members.length < 2) continue;
    const supernode = createSupernode(members);
    supernodeNodes.push(supernode);
    supernodes.push({ id: supernode.id, members });
    for (const m of members) memberToSupernode.set(m, supernode.id);
  }

  // Replace members with supernodes in the node list.
  const condensedNodes: DependencyNode[] = [];
  for (const node of nodes) {
    if (memberToSupernode.has(node.id)) continue;
    condensedNodes.push(node);
  }
  for (const sn of supernodeNodes) condensedNodes.push(sn);

  // Rewrite edges: endpoints mapped to supernode ids; drop intra-SCC edges.
  const condensedEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const mappedSource = memberToSupernode.get(edge.source) ?? edge.source;
    const mappedTarget = memberToSupernode.get(edge.target) ?? edge.target;
    if (mappedSource === mappedTarget && memberToSupernode.has(edge.source)) {
      // Both endpoints collapsed into the same supernode — intra-SCC edge,
      // rendered inside the supernode, not in the main flow.
      continue;
    }
    if (mappedSource === edge.source && mappedTarget === edge.target) {
      condensedEdges.push(edge);
    } else {
      condensedEdges.push({
        ...edge,
        source: mappedSource,
        target: mappedTarget,
      });
    }
  }

  return { condensedNodes, condensedEdges, supernodes, memberToSupernode };
}
