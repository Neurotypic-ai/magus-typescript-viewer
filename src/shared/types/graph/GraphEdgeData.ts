import type { DependencyEdgeKind } from './DependencyEdgeKind';

/** Serializable anchor (matches Vue Flow `XYPosition` structurally). */
export interface GraphEdgeAnchor {
  x: number;
  y: number;
}

/**
 * Edge data carried on dependency graph edges (serializable; no Vue Flow types).
 */
export interface GraphEdgeData {
  type?: DependencyEdgeKind;
  importName?: string | undefined;
  usageKind?: 'method' | 'property' | undefined;
  bundledCount?: number;
  bundledTypes?: DependencyEdgeKind[];
  sourceAnchor?: GraphEdgeAnchor;
  targetAnchor?: GraphEdgeAnchor;
  aggregatedCount?: number;
  isBackEdge?: boolean;
}
