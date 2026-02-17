import { MarkerType } from '@vue-flow/core';
import { computed } from 'vue';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';
import { getRenderingStrategy } from '../rendering/strategyRegistry';

import type { DefaultEdgeOptions } from '@vue-flow/core';
import type { ComputedRef, Ref } from 'vue';
import type { RenderingStrategy, RenderingStrategyId } from '../rendering/RenderingStrategy';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

export interface GraphRenderingThresholds {
  EDGE_VISIBLE_RENDER_THRESHOLD: number;
  MINIMAP_AUTO_HIDE_EDGE_THRESHOLD: number;
  HEAVY_EDGE_STYLE_THRESHOLD: number;
  HIGH_EDGE_MARKER_THRESHOLD: number;
  LOW_DETAIL_EDGE_ZOOM_THRESHOLD: number;
  NODE_VISIBLE_RENDER_THRESHOLD: number;
}

export interface UseGraphRenderingStateOptions {
  env: GraphRenderingThresholds;
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  viewportState: Ref<{ x: number; y: number; zoom: number }>;
  isLayoutMeasuring: Ref<boolean>;
  visualEdges: Ref<GraphEdge[]>;
  highlightedEdgeIds: Ref<Set<string>>;
  edgeVirtualizationEnabled: Ref<boolean>;
  isFirefox: Ref<boolean>;
  canvasRendererAvailable: Ref<boolean>;
  renderingStrategyId: Readonly<Ref<RenderingStrategyId>>;
}

export interface GraphRenderingState {
  activeRenderingStrategy: ComputedRef<RenderingStrategy>;
  isCanvasModeRequested: ComputedRef<boolean>;
  isHybridCanvasMode: ComputedRef<boolean>;
  renderedEdges: ComputedRef<GraphEdge[]>;
  useOnlyRenderVisibleElements: ComputedRef<boolean>;
  isHeavyEdgeMode: ComputedRef<boolean>;
  minimapAutoHidden: ComputedRef<boolean>;
  showMiniMap: ComputedRef<boolean>;
  defaultEdgeOptions: ComputedRef<DefaultEdgeOptions>;
}

export function useGraphRenderingState(options: UseGraphRenderingStateOptions): GraphRenderingState {
  const {
    env,
    nodes,
    edges,
    viewportState,
    isLayoutMeasuring,
    visualEdges,
    highlightedEdgeIds,
    edgeVirtualizationEnabled,
    isFirefox,
    canvasRendererAvailable,
    renderingStrategyId,
  } = options;

  const activeRenderingStrategy = computed(() => getRenderingStrategy(renderingStrategyId.value));
  const isCanvasModeRequested = computed(() => activeRenderingStrategy.value.runtime.edgeMode === 'canvas');

  const isHybridCanvasMode = computed(() => canvasRendererAvailable.value && isCanvasModeRequested.value);

  const renderedEdges = computed(() => {
    if (!isHybridCanvasMode.value) return visualEdges.value;
    if (highlightedEdgeIds.value.size === 0) return [];
    return visualEdges.value.filter((edge) => highlightedEdgeIds.value.has(edge.id));
  });

  const useOnlyRenderVisibleElements = computed(() => {
    if (isLayoutMeasuring.value) return false;
    if (isHybridCanvasMode.value) return false;
    return (
      (edgeVirtualizationEnabled.value && edges.value.length >= env.EDGE_VISIBLE_RENDER_THRESHOLD) ||
      nodes.value.length >= env.NODE_VISIBLE_RENDER_THRESHOLD
    );
  });

  const isHeavyEdgeMode = computed(() => edges.value.length >= env.HEAVY_EDGE_STYLE_THRESHOLD);
  const minimapAutoHidden = computed(() => edges.value.length >= env.MINIMAP_AUTO_HIDE_EDGE_THRESHOLD);
  const showMiniMap = computed(() => !isFirefox.value && !isHybridCanvasMode.value && !minimapAutoHidden.value);

  const defaultEdgeOptions = computed<DefaultEdgeOptions>(() => {
    const lowDetailEdges =
      edges.value.length >= env.HIGH_EDGE_MARKER_THRESHOLD ||
      viewportState.value.zoom < env.LOW_DETAIL_EDGE_ZOOM_THRESHOLD;

    if (lowDetailEdges) {
      return { zIndex: 2, type: 'straight' };
    }
    return {
      markerEnd: { type: MarkerType.ArrowClosed, width: EDGE_MARKER_WIDTH_PX, height: EDGE_MARKER_HEIGHT_PX },
      zIndex: 2,
      type: 'smoothstep',
    };
  });

  return {
    activeRenderingStrategy,
    isCanvasModeRequested,
    isHybridCanvasMode,
    renderedEdges,
    useOnlyRenderVisibleElements,
    isHeavyEdgeMode,
    minimapAutoHidden,
    showMiniMap,
    defaultEdgeOptions,
  };
}
