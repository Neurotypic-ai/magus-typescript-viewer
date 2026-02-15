import { Position } from '@vue-flow/core';

import { getEdgeStyle, getNodeStyle } from '../theme/graphTheme';
import { toDependencyEdgeKind } from './edgeKindUtils';

import type { DependencyKind, DependencyNode, GraphEdge } from '../types';

// ── Environment variable parsing ──

export const parseEnvInt = (key: string, fallback: number): number => {
  const raw = import.meta.env[key] as string | undefined;
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const parseEnvBoolean = (key: string, fallback: boolean): boolean => {
  const raw = import.meta.env[key] as string | undefined;
  if (!raw) {
    return fallback;
  }

  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

// ── CSS class helpers ──

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

// ── Style helpers ──

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

// ── Node class/style helpers ──

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

// ── Dimension helpers ──

export const toDimensionValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const getNodeDims = (n: DependencyNode): { w: number; h: number } => {
  const measured = (n as { measured?: { width?: number; height?: number } }).measured;
  return {
    w: measured?.width ?? (typeof n.width === 'number' ? n.width : 280),
    h: measured?.height ?? (typeof n.height === 'number' ? n.height : 200),
  };
};

// ── Layout helpers ──

export const getHandlePositions = (
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  switch (direction) {
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }
};

export const getEnabledNodeTypes = (enabledNodeTypes: string[]): Set<string> => {
  return new Set(enabledNodeTypes);
};

export const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

export const collectNodesNeedingInternalsUpdate = (previous: DependencyNode[], next: DependencyNode[]): string[] => {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const changedIds: string[] = [];

  next.forEach((node) => {
    const prev = previousById.get(node.id);
    if (!prev) {
      changedIds.push(node.id);
      return;
    }

    if (
      prev.sourcePosition !== node.sourcePosition ||
      prev.targetPosition !== node.targetPosition ||
      prev.parentNode !== node.parentNode
    ) {
      changedIds.push(node.id);
      return;
    }

    const prevMeasured = (prev as { measured?: { width?: number; height?: number } }).measured;
    const nextMeasured = (node as { measured?: { width?: number; height?: number } }).measured;
    const prevStyle = typeof prev.style === 'object' ? (prev.style as Record<string, unknown>) : {};
    const nextStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};

    const prevWidth = prevMeasured?.width ?? toDimensionValue(prevStyle['width']) ?? toDimensionValue(prev.width) ?? 0;
    const prevHeight =
      prevMeasured?.height ?? toDimensionValue(prevStyle['height']) ?? toDimensionValue(prev.height) ?? 0;
    const nextWidth = nextMeasured?.width ?? toDimensionValue(nextStyle['width']) ?? toDimensionValue(node.width) ?? 0;
    const nextHeight =
      nextMeasured?.height ?? toDimensionValue(nextStyle['height']) ?? toDimensionValue(node.height) ?? 0;

    if (Math.abs(prevWidth - nextWidth) > 1 || Math.abs(prevHeight - nextHeight) > 1) {
      changedIds.push(node.id);
    }
  });

  return changedIds;
};

// ── Async paint helpers ──

export const waitForNextPaint = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => { resolve(); });
  });
};

// ── Set difference utility ──

export const addSetDiff = (target: Set<string>, previous: Set<string>, next: Set<string>): void => {
  previous.forEach((id) => {
    if (!next.has(id)) {
      target.add(id);
    }
  });
  next.forEach((id) => {
    if (!previous.has(id)) {
      target.add(id);
    }
  });
};
