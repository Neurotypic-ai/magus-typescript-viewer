import { getNodeStyle } from './graphTheme';

import type { DependencyKind } from '../types/DependencyKind';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

// ── CSS class constants ──

export const EDGE_HOVER_CLASS = 'edge-hover-highlighted';
export const EDGE_HOVER_Z_INDEX = 12;
export const EDGE_HOVER_BASE_STROKE_VAR = '--edge-hover-base-stroke';
export const EDGE_HOVER_FALLBACK_STROKE = '#404040';
export const NODE_SELECTION_CLASS_TOKENS = ['selection-target', 'selection-connected', 'selection-dimmed'] as const;
export const EDGE_SELECTION_CLASS_TOKENS = [
  'edge-selection-highlighted',
  'edge-selection-dimmed',
  EDGE_HOVER_CLASS,
] as const;

// ── Class manipulation ──

export const normalizeClassValue = (className: unknown): string => {
  if (typeof className !== 'string') {
    return '';
  }
  return className.trim();
};

export const getClassTokens = (className: unknown): Set<string> => {
  const normalizedClass = normalizeClassValue(className);
  if (!normalizedClass) {
    return new Set<string>();
  }
  return new Set(normalizedClass.split(/\s+/).filter((token) => token.length > 0));
};

export const normalizeEdgeClass = (edgeClass: GraphEdge['class']): string => {
  return normalizeClassValue(edgeClass);
};

export const getEdgeClassTokens = (edgeClass: GraphEdge['class']): Set<string> => {
  return getClassTokens(edgeClass);
};

export const edgeClassTokensToString = (tokens: Set<string>): string => {
  return [...tokens].join(' ');
};

// ── Strip/merge helpers ──

export const stripNodeClass = (node: DependencyNode): DependencyNode => {
  if (node.class === undefined || node.class === '') {
    return node;
  }
  return { ...node, class: '' } as DependencyNode;
};

export const stripEdgeClass = (edge: GraphEdge): GraphEdge => {
  if (edge.class === undefined || edge.class === '') {
    return edge;
  }
  return { ...edge, class: '' } as GraphEdge;
};

export const mergeNodeInteractionStyle = (
  node: DependencyNode,
  interactionStyle: Record<string, string | number | undefined>
): Record<string, string | number | undefined> => {
  const currentStyle =
    typeof node.style === 'object' ? (node.style as Record<string, string | number | undefined>) : {};

  if (Object.keys(interactionStyle).every((key) => currentStyle[key] === interactionStyle[key])) {
    return currentStyle;
  }

  const baseStyle = getNodeStyle(node.type as DependencyKind);

  const preservedSizing = {
    width: currentStyle['width'],
    height: currentStyle['height'],
    minWidth: currentStyle['minWidth'],
    minHeight: currentStyle['minHeight'],
    overflow: currentStyle['overflow'],
    zIndex: currentStyle['zIndex'],
  };

  return {
    ...baseStyle,
    ...preservedSizing,
    ...interactionStyle,
  };
};
