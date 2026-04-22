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
  /**
   * The cardinal side this edge attaches to at its target node (set by
   * Phase 2 `assignEdgeSides`). Downstream phases (e.g. Phase 3 fan-in
   * trunks) read this to group edges arriving on the same side.
   */
  edgeSide?: 'left' | 'right' | 'top' | 'bottom';
  /**
   * The cardinal side this edge exits from at its source node (set by
   * Phase 2 `assignEdgeSides`).
   */
  edgeSourceSide?: 'left' | 'right' | 'top' | 'bottom';
}
