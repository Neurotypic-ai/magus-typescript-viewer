import type { DependencyNode } from './DependencyNode';
import type { GraphEdge } from './GraphEdge';

/**
 * Graph data: nodes + edges. Named GraphData to avoid collision with DependencyGraph.vue component.
 */
export interface GraphData {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}
