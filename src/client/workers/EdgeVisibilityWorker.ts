import {
  DEFAULT_EDGE_VIRTUALIZATION_CONFIG,
  buildEdgePriorityOrder,
  computeEdgePrioritySignature,
  computeEdgeVirtualizationResult,
} from '../composables/edgeVirtualizationCore';

import type {
  EdgeVirtualizationComputationInput,
  EdgeVirtualizationComputationResult,
  EdgeVirtualizationConfig,
  EdgeVirtualizationEdge,
  EdgeVirtualizationNode,
} from '../types';
import type {
  EdgeVisibilityErrorMessage,
  RecalculateResultMessage,
  RecalculateResultPayload,
  WorkerRequestMessage,
} from '../composables/edgeVisibilityMessages';

let cachedNodes: EdgeVirtualizationNode[] = [];
let cachedEdges: EdgeVirtualizationEdge[] = [];
let cachedPrioritySignature = '';
let cachedPriorityOrder: string[] = [];
let cachedPriorityConfigSignature = '';

const resolveConfig = (overrides?: Partial<EdgeVirtualizationConfig>): EdgeVirtualizationConfig => {
  return {
    ...DEFAULT_EDGE_VIRTUALIZATION_CONFIG,
    ...(overrides ?? {}),
    edgeTypePriority: overrides?.edgeTypePriority ?? DEFAULT_EDGE_VIRTUALIZATION_CONFIG.edgeTypePriority,
  };
};

const priorityConfigSignature = (config: EdgeVirtualizationConfig): string => {
  return JSON.stringify(config.edgeTypePriority);
};

const ensureEdgePriorityOrder = (config: EdgeVirtualizationConfig): void => {
  const nextPrioritySignature = computeEdgePrioritySignature(cachedEdges);
  const nextPriorityConfigSignature = priorityConfigSignature(config);
  if (
    nextPrioritySignature === cachedPrioritySignature &&
    nextPriorityConfigSignature === cachedPriorityConfigSignature &&
    cachedPriorityOrder.length > 0
  ) {
    return;
  }

  cachedPrioritySignature = nextPrioritySignature;
  cachedPriorityConfigSignature = nextPriorityConfigSignature;
  cachedPriorityOrder = buildEdgePriorityOrder(cachedEdges, config.edgeTypePriority);
};

const toResultPayload = (
  result: EdgeVirtualizationComputationResult | null
): Pick<RecalculateResultPayload, 'hiddenEdgeIds' | 'viewportVisibleCount' | 'finalVisibleCount' | 'lowZoomApplied'> & {
  lowZoomBudget?: number;
} => {
  if (!result) {
    return {
      hiddenEdgeIds: [],
      viewportVisibleCount: 0,
      finalVisibleCount: 0,
      lowZoomApplied: false,
    };
  }

  const payload: Pick<
    RecalculateResultPayload,
    'hiddenEdgeIds' | 'viewportVisibleCount' | 'finalVisibleCount' | 'lowZoomApplied'
  > & { lowZoomBudget?: number } = {
    hiddenEdgeIds: [...result.hiddenEdgeIds],
    viewportVisibleCount: result.viewportVisibleEdgeIds.size,
    finalVisibleCount: result.finalVisibleEdgeIds.size,
    lowZoomApplied: result.lowZoomApplied,
  };
  if (result.lowZoomBudget !== undefined) {
    payload.lowZoomBudget = result.lowZoomBudget;
  }

  return payload;
};

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;

  try {
    if (message.type === 'sync-graph') {
      cachedNodes = message.payload.nodes;
      cachedEdges = message.payload.edges;
      cachedPrioritySignature = '';
      cachedPriorityOrder = [];
      return;
    }

    const config = resolveConfig(message.payload.config);
    ensureEdgePriorityOrder(config);

    const input: EdgeVirtualizationComputationInput = {
      nodes: cachedNodes,
      edges: cachedEdges,
      viewport: message.payload.viewport,
      containerSize: message.payload.containerSize ?? null,
      userHiddenEdgeIds: message.payload.userHiddenEdgeIds,
      edgePriorityOrder: cachedPriorityOrder,
      config,
    };
    if (message.payload.deviceProfile) {
      input.deviceProfile = message.payload.deviceProfile;
    }

    const result = computeEdgeVirtualizationResult(input);

    const response: RecalculateResultMessage = {
      type: 'edge-visibility-result',
      requestId: message.requestId,
      payload: {
        recalcVersion: message.payload.recalcVersion,
        graphVersion: message.payload.graphVersion,
        ...toResultPayload(result),
      },
    };
    self.postMessage(response);
  } catch (error) {
    const response: EdgeVisibilityErrorMessage = {
      type: 'edge-visibility-error',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown worker error',
      },
    };
    if (message.type === 'recalculate') {
      response.requestId = message.requestId;
    }
    self.postMessage(response);
  }
};

export {};
