import type { Edge, SmoothStepPathOptions } from '@vue-flow/core';

import type { GraphEdgeData } from '../../shared/types/graph/GraphEdgeData';

/**
 * Graph edge extending Vue Flow's Edge
 */
export type GraphEdge = Edge<GraphEdgeData> & {
  pathOptions?: SmoothStepPathOptions;
};
