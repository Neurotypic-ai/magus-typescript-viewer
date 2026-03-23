import { computed } from 'vue';

import { MarkerType } from '@vue-flow/core';

import { EDGE_MARKER_HEIGHT_PX, EDGE_MARKER_WIDTH_PX } from '../layout/edgeGeometryPolicy';

import type { ComputedRef, Ref } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

interface GraphRenderingThresholds {
  EDGE_VISIBLE_RENDER_THRESHOLD: number;
  MINIMAP_AUTO_HIDE_EDGE_THRESHOLD: number;
  HEAVY_EDGE_STYLE_THRESHOLD: number;
  HIGH_EDGE_MARKER_THRESHOLD: number;
  LOW_DETAIL_EDGE_ZOOM_THRESHOLD: number;
  NODE_VISIBLE_RENDER_THRESHOLD: number;
}

interface UseGraphRenderingStateOptions {
  env: GraphRenderingThresholds;
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  viewportState: Ref<{ x: number; y: number; zoom: number }>;
  visualEdges: Ref<GraphEdge[]>;
  isFirefox: Ref<boolean>;
}

interface GraphRenderingState {
  renderedEdges: ComputedRef<GraphEdge[]>;
  useOnlyRenderVisibleElements: ComputedRef<boolean>;
  isHeavyEdgeMode: ComputedRef<boolean>;
  minimapAutoHidden: ComputedRef<boolean>;
  showMiniMap: ComputedRef<boolean>;
  defaultEdgeOptions: ComputedRef<Record<string, unknown>>;
}

export function useGraphRenderingState(options: UseGraphRenderingStateOptions): GraphRenderingState {
  const { env, nodes, edges, viewportState, visualEdges, isFirefox } = options;

  const renderedEdges = computed(() => visualEdges.value);

  const useOnlyRenderVisibleElements = computed(() => {
    return (
      edges.value.length >= env.EDGE_VISIBLE_RENDER_THRESHOLD || nodes.value.length >= env.NODE_VISIBLE_RENDER_THRESHOLD
    );
  });

  const isHeavyEdgeMode = computed(() => edges.value.length >= env.HEAVY_EDGE_STYLE_THRESHOLD);
  const minimapAutoHidden = computed(() => edges.value.length >= env.MINIMAP_AUTO_HIDE_EDGE_THRESHOLD);
  const showMiniMap = computed(() => !isFirefox.value && !minimapAutoHidden.value);

  const defaultEdgeOptions = computed(() => {
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
    renderedEdges,
    useOnlyRenderVisibleElements,
    isHeavyEdgeMode,
    minimapAutoHidden,
    showMiniMap,
    defaultEdgeOptions,
  };
}
