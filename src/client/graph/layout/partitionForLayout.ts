/**
 * partitionForLayout — split a graph into the three populations defined by the
 * Phase 1 hub-aware layout plan.
 *
 * See `/Users/khallmark/.claude/plans/you-are-inside-a-snug-ocean.md` §4.1,
 * §8.1 for the reasoning.  In short: module→module imports form a
 * hierarchically layerable backbone ("internal"); module→externalPackage
 * imports form convergent star-fans that Sugiyama handles poorly ("external");
 * mutually recursive supernodes ("scc") are added in Phase 5.
 *
 * This phase only introduces `external` as a first-class partition.  We filter
 * `scc` out of the internal bucket proactively so Phase 5 can later emit
 * supernodes without this function needing to change.
 */

import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

export interface PartitionedGraph {
  /** Nodes that participate in the classic layered backbone. */
  internal: DependencyNode[];
  /** External-package nodes (fan-in hubs for module → externalPackage edges). */
  external: DependencyNode[];
  /** Edges between two internal nodes — the input to Sugiyama. */
  internalEdges: GraphEdge[];
  /** Edges where at least one endpoint is external. */
  externalIncidentEdges: GraphEdge[];
}

/**
 * Split nodes and edges into the internal / external populations.
 *
 * Algorithm: O(V + E) single-pass classification.
 *
 * Forward-compatibility note: `scc` nodes are excluded from the `internal`
 * bucket so that Phase 5 can add them without changing this function's
 * contract. For Phase 1 there are no `scc` nodes yet, so the filter is a
 * no-op.
 */
export function partitionForLayout(
  nodes: DependencyNode[],
  edges: GraphEdge[]
): PartitionedGraph {
  const externalIds = new Set<string>();
  const external: DependencyNode[] = [];
  const internal: DependencyNode[] = [];

  for (const node of nodes) {
    if (node.type === 'externalPackage') {
      externalIds.add(node.id);
      external.push(node);
      continue;
    }
    // Phase 5 adds the `scc` kind. Keep the filter forward-compatible so the
    // internal bucket stays strictly the layerable backbone.
    if (node.type === 'scc') {
      continue;
    }
    internal.push(node);
  }

  const internalEdges: GraphEdge[] = [];
  const externalIncidentEdges: GraphEdge[] = [];

  for (const edge of edges) {
    const sourceIsExternal = externalIds.has(edge.source);
    const targetIsExternal = externalIds.has(edge.target);
    if (sourceIsExternal || targetIsExternal) {
      externalIncidentEdges.push(edge);
    } else {
      internalEdges.push(edge);
    }
  }

  return { internal, external, internalEdges, externalIncidentEdges };
}
