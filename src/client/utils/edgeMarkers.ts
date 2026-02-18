import { MarkerType } from '@vue-flow/core';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';

export interface EdgeMarkerConfig {
  type: MarkerType;
  width: number;
  height: number;
}

export function createEdgeMarker(): EdgeMarkerConfig {
  return {
    type: MarkerType.ArrowClosed,
    width: EDGE_MARKER_WIDTH_PX,
    height: EDGE_MARKER_HEIGHT_PX,
  };
}
