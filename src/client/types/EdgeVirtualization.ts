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
