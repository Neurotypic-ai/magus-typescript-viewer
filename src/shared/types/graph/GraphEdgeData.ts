import type { DependencyEdgeKind } from './DependencyEdgeKind';

/** Serializable anchor (matches Vue Flow `XYPosition` structurally). */
export interface GraphEdgeAnchor {
  x: number;
  y: number;
}

/**
 * Cardinal side at which an edge attaches to a node. Populated by Phase 2's
 * `assignEdgeSides` — Phase 3 reads `edgeSide` to group converging edges.
 * When undefined (Phase 2 not yet integrated), fan-in bundling treats the
 * side as `'left'`, which matches the current hardcoded handle routing.
 */
export type GraphEdgeSide = 'left' | 'right' | 'top' | 'bottom';

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
  /** Cardinal side at which the edge enters the target (Phase 2). */
  edgeSide?: GraphEdgeSide;
  /** Cardinal side at which the edge leaves the source (Phase 2). */
  edgeSourceSide?: GraphEdgeSide;
  /** Id of the fan-in trunk group the edge participates in (Phase 3). */
  trunkId?: string;
  /** Role within the fan-in trunk group (Phase 3). */
  trunkRole?: 'stub' | 'trunk';
  /**
   * X coordinate of the synthetic junction point for the trunk. Only set on
   * the trunk edge itself so the renderer can draw the trunk as a single
   * path without having to materialise a real node for the junction.
   */
  trunkJunctionX?: number;
  /** Y coordinate of the synthetic junction point for the trunk. */
  trunkJunctionY?: number;
}
