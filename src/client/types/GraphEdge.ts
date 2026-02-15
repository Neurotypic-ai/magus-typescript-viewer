import type { Edge } from '@vue-flow/core';
import type { DependencyEdgeKind } from './DependencyEdgeKind';

/**
 * Graph edge extending Vue Flow's Edge
 */
export type GraphEdge = Edge<{
  type?: DependencyEdgeKind;
  importName?: string | undefined;
  usageKind?: 'method' | 'property' | undefined;
  bundledCount?: number;
  bundledTypes?: DependencyEdgeKind[];
  sourceAnchor?: { x: number; y: number };
  targetAnchor?: { x: number; y: number };
  aggregatedCount?: number;
  highwaySegment?: 'exit' | 'highway' | 'entry';
  highwayCount?: number;
  highwayTypes?: DependencyEdgeKind[];
  highwayGroupId?: string;
  highwayTypeBreakdown?: Partial<Record<DependencyEdgeKind, number>>;
}> & {
  pathOptions?: {
    offset?: number;
    borderRadius?: number;
  };
};
