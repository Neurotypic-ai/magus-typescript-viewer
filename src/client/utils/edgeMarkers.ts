import { MarkerType } from '@vue-flow/core';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';

export function createEdgeMarker() {
  return {
    type: MarkerType.ArrowClosed,
    width: EDGE_MARKER_WIDTH_PX,
    height: EDGE_MARKER_HEIGHT_PX,
  };
}
