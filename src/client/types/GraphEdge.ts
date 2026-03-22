import type { Edge, SmoothStepPathOptions, XYPosition } from '@vue-flow/core';
import type { DependencyEdgeKind } from './DependencyEdgeKind';

/**
 * Graph edge extending Vue Flow's Edge
 */
export interface GraphEdgeData {
  type?: DependencyEdgeKind;
  importName?: string | undefined;
  usageKind?: 'method' | 'property' | undefined;
  bundledCount?: number;
  bundledTypes?: DependencyEdgeKind[];
  sourceAnchor?: XYPosition;
  targetAnchor?: XYPosition;
  aggregatedCount?: number;
  highwaySegment?: 'exit' | 'highway' | 'entry';
  highwayCount?: number;
  highwayTypes?: DependencyEdgeKind[];
  highwayGroupId?: string;
  highwayTypeBreakdown?: Partial<Record<DependencyEdgeKind, number>>;
}

export type GraphEdge = Edge<GraphEdgeData> & {
  pathOptions?: SmoothStepPathOptions;
};
