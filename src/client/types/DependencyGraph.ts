import type { DependencyNode } from './DependencyNode';
import type { GraphEdge } from './GraphEdge';

/**
 * Unified graph structure
 */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}
