<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

import { measurePerformance } from '../../../utils/performanceMonitoring';

import type { DependencyNode, GraphEdge } from '../types';

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface CanvasEdgeLayerProps {
  edges: GraphEdge[];
  nodes: DependencyNode[];
  viewport: ViewportState;
  maxEdges?: number;
  highlightedEdgeIds?: string[];
  dimNonHighlighted?: boolean;
}

const props = withDefaults(defineProps<CanvasEdgeLayerProps>(), {
  maxEdges: 2400,
  highlightedEdgeIds: () => [],
  dimNonHighlighted: true,
});
const emit = defineEmits<{
  (event: 'canvas-unavailable'): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let renderRafId: number | null = null;
let hasEmittedCanvasUnavailable = false;

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 100;
const PERF_MARKS_ENABLED = (import.meta.env['VITE_PERF_MARKS'] as string | undefined) === 'true';

const parseDimension = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const buildAbsoluteNodeCenters = (nodeList: DependencyNode[]): Map<string, { x: number; y: number }> => {
  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  const centerById = new Map<string, { x: number; y: number }>();
  const resolving = new Set<string>();

  const resolveCenter = (nodeId: string): { x: number; y: number } | null => {
    const cached = centerById.get(nodeId);
    if (cached) {
      return cached;
    }
    if (resolving.has(nodeId)) {
      return null;
    }

    const node = nodeById.get(nodeId);
    if (!node?.position) {
      return null;
    }

    resolving.add(nodeId);

    const nodeStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
    const measured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
    const width = parseDimension(nodeStyle['width']) ?? measured?.width ?? DEFAULT_NODE_WIDTH;
    const height = parseDimension(nodeStyle['height']) ?? measured?.height ?? DEFAULT_NODE_HEIGHT;

    let absoluteX = node.position.x;
    let absoluteY = node.position.y;

    const parentId = (node as { parentNode?: string }).parentNode;
    if (parentId) {
      const parentCenter = resolveCenter(parentId);
      const parentNode = nodeById.get(parentId);
      if (parentCenter && parentNode?.position) {
        const parentStyle =
          typeof parentNode.style === 'object' ? (parentNode.style as Record<string, unknown>) : {};
        const parentMeasured = (parentNode as unknown as { measured?: { width?: number; height?: number } }).measured;
        const parentWidth = parseDimension(parentStyle['width']) ?? parentMeasured?.width ?? DEFAULT_NODE_WIDTH;
        const parentHeight = parseDimension(parentStyle['height']) ?? parentMeasured?.height ?? DEFAULT_NODE_HEIGHT;
        absoluteX += parentCenter.x - parentWidth / 2;
        absoluteY += parentCenter.y - parentHeight / 2;
      }
    }

    const resolved = {
      x: absoluteX + width / 2,
      y: absoluteY + height / 2,
    };
    centerById.set(nodeId, resolved);
    resolving.delete(nodeId);
    return resolved;
  };

  nodeList.forEach((node) => {
    resolveCenter(node.id);
  });

  return centerById;
};

const toScreenPoint = (point: { x: number; y: number }, viewport: ViewportState): { x: number; y: number } => {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
};

const isSegmentNearViewport = (
  source: { x: number; y: number },
  target: { x: number; y: number },
  width: number,
  height: number
): boolean => {
  const padding = 120;
  const minX = Math.min(source.x, target.x);
  const maxX = Math.max(source.x, target.x);
  const minY = Math.min(source.y, target.y);
  const maxY = Math.max(source.y, target.y);
  return !(maxX < -padding || minX > width + padding || maxY < -padding || minY > height + padding);
};

const scheduleRender = (): void => {
  if (renderRafId !== null) {
    cancelAnimationFrame(renderRafId);
  }
  renderRafId = requestAnimationFrame(() => {
    renderRafId = null;
    renderCanvas();
  });
};

const renderCanvas = (): void => {
  if (PERF_MARKS_ENABLED) {
    performance.mark('canvas-render-start');
  }

  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) {
    if (PERF_MARKS_ENABLED) {
      performance.mark('canvas-render-end');
      measurePerformance('canvas-edge-render', 'canvas-render-start', 'canvas-render-end');
    }
    return;
  }

  const width = Math.max(1, Math.floor(container.clientWidth));
  const height = Math.max(1, Math.floor(container.clientHeight));
  const devicePixelRatio = window.devicePixelRatio || 1;
  const scaledWidth = Math.floor(width * devicePixelRatio);
  const scaledHeight = Math.floor(height * devicePixelRatio);

  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    if (!hasEmittedCanvasUnavailable) {
      hasEmittedCanvasUnavailable = true;
      emit('canvas-unavailable');
    }
    if (PERF_MARKS_ENABLED) {
      performance.mark('canvas-render-end');
      measurePerformance('canvas-edge-render', 'canvas-render-start', 'canvas-render-end');
    }
    return;
  }

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = 'round';

  const nodeCenters = buildAbsoluteNodeCenters(props.nodes);
  const highlightedEdgeIdSet = new Set(props.highlightedEdgeIds);
  const visibleEdges = props.edges
    .filter((edge) => !edge.hidden && !highlightedEdgeIdSet.has(edge.id))
    .slice(0, props.maxEdges);

  for (const edge of visibleEdges) {
    const sourceAnchor = edge.data?.sourceAnchor as { x: number; y: number } | undefined;
    const targetAnchor = edge.data?.targetAnchor as { x: number; y: number } | undefined;
    const sourcePoint = sourceAnchor ?? nodeCenters.get(edge.source);
    const targetPoint = targetAnchor ?? nodeCenters.get(edge.target);
    if (!sourcePoint || !targetPoint) {
      continue;
    }

    const sourceScreen = toScreenPoint(sourcePoint, props.viewport);
    const targetScreen = toScreenPoint(targetPoint, props.viewport);
    if (!isSegmentNearViewport(sourceScreen, targetScreen, width, height)) {
      continue;
    }

    const edgeStyle = typeof edge.style === 'object' ? (edge.style as Record<string, unknown>) : {};
    const stroke = typeof edgeStyle['stroke'] === 'string' ? edgeStyle['stroke'] : 'rgba(148, 163, 184, 0.5)';
    const opacity = typeof edgeStyle['opacity'] === 'number'
      ? edgeStyle['opacity']
      : Number.parseFloat(String(edgeStyle['opacity'] ?? '0.85'));
    const strokeWidth = typeof edgeStyle['strokeWidth'] === 'number'
      ? edgeStyle['strokeWidth']
      : Number.parseFloat(String(edgeStyle['strokeWidth'] ?? '1.4'));
    const dimFactor = props.dimNonHighlighted && highlightedEdgeIdSet.size > 0 ? 0.65 : 1;

    context.strokeStyle = stroke;
    context.globalAlpha = Number.isFinite(opacity)
      ? Math.max(0.04, Math.min(1, opacity * dimFactor))
      : 0.85 * dimFactor;
    context.lineWidth = Number.isFinite(strokeWidth)
      ? Math.max(0.8, strokeWidth * Math.max(0.55, Math.min(1.1, props.viewport.zoom)))
      : 1.2;
    context.beginPath();
    context.moveTo(sourceScreen.x, sourceScreen.y);
    context.lineTo(targetScreen.x, targetScreen.y);
    context.stroke();
  }

  context.globalAlpha = 1;

  if (PERF_MARKS_ENABLED) {
    performance.mark('canvas-render-end');
    measurePerformance('canvas-edge-render', 'canvas-render-start', 'canvas-render-end');
  }
};

onMounted(() => {
  scheduleRender();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      scheduleRender();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  if (renderRafId !== null) {
    cancelAnimationFrame(renderRafId);
    renderRafId = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});

watch(
  () => [props.edges, props.nodes, props.viewport.x, props.viewport.y, props.viewport.zoom, props.highlightedEdgeIds],
  () => {
    scheduleRender();
  },
  { deep: false }
);
</script>

<template>
  <div ref="containerRef" class="canvas-edge-layer" aria-hidden="true">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<style scoped>
.canvas-edge-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.canvas-edge-layer canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
