import { buildAbsoluteNodeBoundsMap as sharedBuildAbsoluteNodeBoundsMap } from '../layout/geometryBounds';
import { buildEdgePolyline, toLineSegments } from '../layout/edgeGeometryPolicy';
import { getHandleAnchor } from '../lib/handleAnchors';

import type { Rect } from '../layout/geometryBounds';

interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type NodeBounds = Rect;

export interface EdgeVirtualizationPoint {
  x: number;
  y: number;
}

export interface EdgeVirtualizationViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface EdgeVirtualizationContainerSize {
  width: number;
  height: number;
}

export interface EdgeVirtualizationNode {
  id: string;
  type?: string;
  position?: EdgeVirtualizationPoint;
  parentNode?: string;
  style?: unknown;
  measured?: {
    width?: number;
    height?: number;
  };
}

export interface EdgeVirtualizationEdge {
  id: string;
  source: string;
  target: string;
  hidden?: boolean;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: {
    type?: string;
    sourceAnchor?: EdgeVirtualizationPoint;
    targetAnchor?: EdgeVirtualizationPoint;
    [key: string]: unknown;
  };
}

export interface EdgeVirtualizationDeviceProfile {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export interface EdgeVirtualizationConfig {
  viewportPaddingPx: number;
  lowZoomThreshold: number;
  lowZoomBaseMaxEdges: number;
  lowZoomMinBudget: number;
  lowZoomMaxBudget: number;
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  defaultContainerWidth: number;
  defaultContainerHeight: number;
  edgeTypePriority: Record<string, number>;
}

export const DEFAULT_EDGE_TYPE_PRIORITY: Record<string, number> = {
  inheritance: 4,
  implements: 3,
  dependency: 2,
  import: 1,
  devDependency: 0,
  peerDependency: 0,
  contains: 5,
  uses: 5,
  export: 0,
  extends: 3,
};

export const DEFAULT_EDGE_VIRTUALIZATION_CONFIG: EdgeVirtualizationConfig = {
  viewportPaddingPx: 300,
  lowZoomThreshold: 0.3,
  lowZoomBaseMaxEdges: 500,
  lowZoomMinBudget: 140,
  lowZoomMaxBudget: 900,
  defaultNodeWidth: 260,
  defaultNodeHeight: 100,
  defaultContainerWidth: 1200,
  defaultContainerHeight: 800,
  edgeTypePriority: DEFAULT_EDGE_TYPE_PRIORITY,
};

/** Minimum edge count before virtualization kicks in. */
export const VIRTUALIZATION_THRESHOLD = 200;

/** Minimum frame spacing for recalculations (ms). Reads VITE_EDGE_VIRTUALIZATION_MIN_FRAME_GAP_MS with fallback 48. */
export function getRecalcMinFrameGapMs(): number {
  const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.[
    'VITE_EDGE_VIRTUALIZATION_MIN_FRAME_GAP_MS'
  ];
  if (!raw) return 48;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
}

/** Default config overrides for edge virtualization (shared by main-thread and worker composables). */
export function getDefaultEdgeVirtualizationConfigOverrides(): Partial<EdgeVirtualizationConfig> {
  return {
    viewportPaddingPx: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.viewportPaddingPx,
    lowZoomThreshold: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.lowZoomThreshold,
    lowZoomBaseMaxEdges: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.lowZoomBaseMaxEdges,
    lowZoomMinBudget: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.lowZoomMinBudget,
    lowZoomMaxBudget: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.lowZoomMaxBudget,
    defaultNodeWidth: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.defaultNodeWidth,
    defaultNodeHeight: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.defaultNodeHeight,
    edgeTypePriority: DEFAULT_EDGE_VIRTUALIZATION_CONFIG.edgeTypePriority,
  };
}

export interface EdgeVirtualizationComputationInput {
  nodes: EdgeVirtualizationNode[];
  edges: EdgeVirtualizationEdge[];
  viewport: EdgeVirtualizationViewport;
  containerSize?: EdgeVirtualizationContainerSize | null;
  userHiddenEdgeIds?: Set<string> | string[];
  edgePriorityOrder: string[];
  config?: Partial<EdgeVirtualizationConfig>;
  deviceProfile?: EdgeVirtualizationDeviceProfile;
}

export interface EdgeVirtualizationComputationResult {
  viewportVisibleEdgeIds: Set<string>;
  finalVisibleEdgeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
  lowZoomBudget?: number;
  lowZoomApplied: boolean;
}

// parseDimension is re-exported from shared geometry module (imported above).

const toUserHiddenSet = (hiddenIds: Set<string> | string[] | undefined): Set<string> => {
  if (!hiddenIds) {
    return new Set<string>();
  }
  if (hiddenIds instanceof Set) {
    return hiddenIds;
  }
  return new Set(hiddenIds);
};

/**
 * Delegate to shared geometry helper, adapting the edge-virtualization config
 * shape to the shared `BoundsDefaults` interface.
 */
const buildAbsoluteNodeBoundsMap = (
  nodeList: EdgeVirtualizationNode[],
  config: EdgeVirtualizationConfig
): Map<string, NodeBounds> => {
  return sharedBuildAbsoluteNodeBoundsMap(nodeList, {
    defaultNodeWidth: config.defaultNodeWidth,
    defaultNodeHeight: config.defaultNodeHeight,
  });
};

const getViewportBounds = (
  viewport: EdgeVirtualizationViewport,
  containerSize: EdgeVirtualizationContainerSize | null | undefined,
  config: EdgeVirtualizationConfig
): ViewportBounds | null => {
  if (viewport.zoom === 0) {
    return null;
  }

  const width = containerSize?.width ?? config.defaultContainerWidth;
  const height = containerSize?.height ?? config.defaultContainerHeight;
  const padding = config.viewportPaddingPx / viewport.zoom;

  return {
    minX: -viewport.x / viewport.zoom - padding,
    minY: -viewport.y / viewport.zoom - padding,
    maxX: (-viewport.x + width) / viewport.zoom + padding,
    maxY: (-viewport.y + height) / viewport.zoom + padding,
  };
};

const isNodeInBounds = (node: NodeBounds, bounds: ViewportBounds): boolean => {
  return (
    node.x + node.width >= bounds.minX &&
    node.x <= bounds.maxX &&
    node.y + node.height >= bounds.minY &&
    node.y <= bounds.maxY
  );
};

const isPointInBounds = (pos: EdgeVirtualizationPoint, bounds: ViewportBounds): boolean => {
  return pos.x >= bounds.minX && pos.x <= bounds.maxX && pos.y >= bounds.minY && pos.y <= bounds.maxY;
};

const segmentIntersectsBounds = (
  start: EdgeVirtualizationPoint,
  end: EdgeVirtualizationPoint,
  bounds: ViewportBounds
): boolean => {
  let t0 = 0;
  let t1 = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const clipTest = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }

    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return false;
      if (ratio > t0) t0 = ratio;
    } else {
      if (ratio < t0) return false;
      if (ratio < t1) t1 = ratio;
    }
    return true;
  };

  return (
    clipTest(-dx, start.x - bounds.minX) &&
    clipTest(dx, bounds.maxX - start.x) &&
    clipTest(-dy, start.y - bounds.minY) &&
    clipTest(dy, bounds.maxY - start.y)
  );
};

const isPolylineInBounds = (points: EdgeVirtualizationPoint[], bounds: ViewportBounds): boolean => {
  if (points.length === 0) return false;
  if (points.some((point) => isPointInBounds(point, bounds))) {
    return true;
  }
  const segments = toLineSegments(points);
  return segments.some((segment) => segmentIntersectsBounds(segment.start, segment.end, bounds));
};

const isEdgeSegmentInBounds = (
  source: NodeBounds,
  target: NodeBounds,
  bounds: ViewportBounds,
  options: {
    sourceHandle?: string | null;
    targetHandle?: string | null;
    sourceNodeType?: string;
    targetNodeType?: string;
  }
): boolean => {
  if (isNodeInBounds(source, bounds) || isNodeInBounds(target, bounds)) {
    return true;
  }

  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const polyline = buildEdgePolyline(sourceCenter, targetCenter, options);
  return isPolylineInBounds(polyline, bounds);
};

export function computeEdgePrioritySignature(edgeList: EdgeVirtualizationEdge[]): string {
  let hash = 0;
  for (const edge of edgeList) {
    const token = `${edge.id}|${edge.data?.type ?? ''}`;
    for (let i = 0; i < token.length; i += 1) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
  }
  return `${String(edgeList.length)}:${String(hash >>> 0)}`;
}

export function buildEdgePriorityOrder(
  edgeList: EdgeVirtualizationEdge[],
  edgeTypePriority: Record<string, number> = DEFAULT_EDGE_TYPE_PRIORITY
): string[] {
  const nodeDegree = new Map<string, number>();
  for (const edge of edgeList) {
    nodeDegree.set(edge.source, (nodeDegree.get(edge.source) ?? 0) + 1);
    nodeDegree.set(edge.target, (nodeDegree.get(edge.target) ?? 0) + 1);
  }

  const scored: { id: string; score: number }[] = [];
  for (const edge of edgeList) {
    const typePriority = edgeTypePriority[edge.data?.type ?? ''] ?? 0;
    const sourceDegree = nodeDegree.get(edge.source) ?? 0;
    const targetDegree = nodeDegree.get(edge.target) ?? 0;
    const score = typePriority * 100 + sourceDegree + targetDegree;
    scored.push({ id: edge.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.id);
}

export function computeAdaptiveLowZoomBudget(
  zoom: number,
  visibleEdgeCount: number,
  config: EdgeVirtualizationConfig,
  deviceProfile?: EdgeVirtualizationDeviceProfile
): number {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;

  const cores = deviceProfile?.hardwareConcurrency ?? nav?.hardwareConcurrency ?? 8;
  const memoryGb = deviceProfile?.deviceMemory ?? nav?.deviceMemory ?? 8;

  let budget = config.lowZoomBaseMaxEdges;
  budget += Math.max(0, (cores - 4) * 24);
  budget += Math.max(0, (memoryGb - 4) * 18);

  if (zoom < 0.2) {
    budget = Math.round(budget * 0.55);
  } else if (zoom < config.lowZoomThreshold) {
    budget = Math.round(budget * 0.75);
  }

  budget = Math.min(config.lowZoomMaxBudget, Math.max(config.lowZoomMinBudget, budget));
  return Math.max(config.lowZoomMinBudget, Math.min(budget, visibleEdgeCount));
}

const applyLowZoomThresholding = (
  visibleEdgeIds: Set<string>,
  zoom: number,
  edgePriorityOrder: string[],
  config: EdgeVirtualizationConfig,
  deviceProfile?: EdgeVirtualizationDeviceProfile
): { keptIds: Set<string>; budget: number } => {
  const maxBudget = computeAdaptiveLowZoomBudget(zoom, visibleEdgeIds.size, config, deviceProfile);
  if (visibleEdgeIds.size <= maxBudget) {
    return { keptIds: visibleEdgeIds, budget: maxBudget };
  }

  const kept = new Set<string>();
  for (const edgeId of edgePriorityOrder) {
    if (!visibleEdgeIds.has(edgeId)) {
      continue;
    }
    kept.add(edgeId);
    if (kept.size >= maxBudget) {
      return { keptIds: kept, budget: maxBudget };
    }
  }

  for (const edgeId of visibleEdgeIds) {
    if (kept.size >= maxBudget) {
      break;
    }
    kept.add(edgeId);
  }

  return { keptIds: kept, budget: maxBudget };
};

export function computeEdgeVirtualizationResult(
  input: EdgeVirtualizationComputationInput
): EdgeVirtualizationComputationResult | null {
  const config: EdgeVirtualizationConfig = {
    ...DEFAULT_EDGE_VIRTUALIZATION_CONFIG,
    ...(input.config ?? {}),
    edgeTypePriority: input.config?.edgeTypePriority ?? DEFAULT_EDGE_VIRTUALIZATION_CONFIG.edgeTypePriority,
  };
  const bounds = getViewportBounds(input.viewport, input.containerSize, config);
  if (!bounds) {
    return null;
  }

  const userHiddenIds = toUserHiddenSet(input.userHiddenEdgeIds);
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const nodeBoundsMap = buildAbsoluteNodeBoundsMap(input.nodes, config);

  const viewportVisibleIds = new Set<string>();
  for (const edge of input.edges) {
    if (userHiddenIds.has(edge.id)) {
      continue;
    }

    const sourceBounds = nodeBoundsMap.get(edge.source);
    const targetBounds = nodeBoundsMap.get(edge.target);
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);

    const sourceHandleAnchor =
      sourceBounds && edge.sourceHandle ? getHandleAnchor(sourceBounds, edge.sourceHandle) : undefined;
    const targetHandleAnchor =
      targetBounds && edge.targetHandle ? getHandleAnchor(targetBounds, edge.targetHandle) : undefined;

    const sourceAnchor = sourceHandleAnchor ?? edge.data?.sourceAnchor;
    const targetAnchor = targetHandleAnchor ?? edge.data?.targetAnchor;
    if (sourceAnchor && targetAnchor) {
      const polylineOptions = {
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        ...(sourceNode?.type ? { sourceNodeType: sourceNode.type } : {}),
        ...(targetNode?.type ? { targetNodeType: targetNode.type } : {}),
      };
      const polyline = buildEdgePolyline(sourceAnchor, targetAnchor, {
        ...polylineOptions,
      });
      if (isPolylineInBounds(polyline, bounds)) {
        viewportVisibleIds.add(edge.id);
      }
      continue;
    }

    if (!sourceBounds || !targetBounds) {
      viewportVisibleIds.add(edge.id);
      continue;
    }

    const fallbackPolylineOptions = {
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      ...(sourceNode?.type ? { sourceNodeType: sourceNode.type } : {}),
      ...(targetNode?.type ? { targetNodeType: targetNode.type } : {}),
    };
    if (isEdgeSegmentInBounds(sourceBounds, targetBounds, bounds, fallbackPolylineOptions)) {
      viewportVisibleIds.add(edge.id);
    }
  }

  let finalVisibleIds = viewportVisibleIds;
  let lowZoomBudget: number | undefined;
  const isLowZoom = input.viewport.zoom < config.lowZoomThreshold;
  if (isLowZoom) {
    const { keptIds, budget } = applyLowZoomThresholding(
      viewportVisibleIds,
      input.viewport.zoom,
      input.edgePriorityOrder,
      config,
      input.deviceProfile
    );
    finalVisibleIds = keptIds;
    lowZoomBudget = budget;
  }

  const hiddenEdgeIds = new Set<string>();
  for (const edge of input.edges) {
    if (userHiddenIds.has(edge.id)) {
      continue;
    }
    if (!finalVisibleIds.has(edge.id)) {
      hiddenEdgeIds.add(edge.id);
    }
  }

  const output: EdgeVirtualizationComputationResult = {
    viewportVisibleEdgeIds: viewportVisibleIds,
    finalVisibleEdgeIds: finalVisibleIds,
    hiddenEdgeIds,
    lowZoomApplied: isLowZoom && finalVisibleIds.size < viewportVisibleIds.size,
  };

  if (lowZoomBudget !== undefined) {
    output.lowZoomBudget = lowZoomBudget;
  }

  return output;
}
