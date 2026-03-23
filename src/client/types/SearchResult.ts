import type { DependencyNode } from './DependencyNode';
import type { GraphEdge } from './GraphEdge';

/**
 * Search results for the graph search component (Vue Flow node/edge instances).
 */
export interface SearchResult {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  path?: DependencyNode[];
}
