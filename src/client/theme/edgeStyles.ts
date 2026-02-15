import { toDependencyEdgeKind } from '../graph/edgeKindUtils';
import { getEdgeStyle } from './graphTheme';
import { EDGE_HOVER_BASE_STROKE_VAR, EDGE_HOVER_FALLBACK_STROKE } from './graphClasses';

import type { GraphEdge } from '../types';

export const toEdgeStyleRecord = (style: GraphEdge['style']): Record<string, string | number | undefined> | undefined => {
  if (typeof style !== 'object') {
    return undefined;
  }
  return style as Record<string, string | number | undefined>;
};

export const getEdgeBaseStroke = (edge: GraphEdge): string => {
  const edgeStyle = toEdgeStyleRecord(edge.style);
  const styleStroke = edgeStyle?.['stroke'];
  if (typeof styleStroke === 'string' && styleStroke.length > 0) {
    return styleStroke;
  }

  const themedStroke = getEdgeStyle(toDependencyEdgeKind(edge.data?.type))['stroke'];
  if (typeof themedStroke === 'string' && themedStroke.length > 0) {
    return themedStroke;
  }

  return EDGE_HOVER_FALLBACK_STROKE;
};

export const applyEdgeHoverStrokeVariable = (edge: GraphEdge, shouldHover: boolean): GraphEdge['style'] => {
  const currentStyle = toEdgeStyleRecord(edge.style);
  if (shouldHover) {
    const baseStroke = getEdgeBaseStroke(edge);
    if (currentStyle?.[EDGE_HOVER_BASE_STROKE_VAR] === baseStroke) {
      return edge.style;
    }
    return {
      ...(currentStyle ?? {}),
      [EDGE_HOVER_BASE_STROKE_VAR]: baseStroke,
    };
  }

  if (!currentStyle || !(EDGE_HOVER_BASE_STROKE_VAR in currentStyle)) {
    return edge.style;
  }

  const { [EDGE_HOVER_BASE_STROKE_VAR]: _, ...nextStyle } = currentStyle;
  return Object.keys(nextStyle).length > 0 ? nextStyle : undefined;
};
