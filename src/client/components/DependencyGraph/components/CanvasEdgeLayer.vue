<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

import { getHandleAnchor } from '../handleAnchors';
import { buildEdgePolyline } from '../layout/edgeGeometryPolicy';
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

const buildAbsoluteNodeGeometry = (nodeList: DependencyNode[]): {
  centerById: Map<string, { x: number; y: number }>;
  boundsById: Map<string, { x: number; y: number; width: number; height: number }>;
} => {
  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  const centerById = new Map<string, { x: number; y: number }>();
  const boundsById = new Map<string, { x: number; y: number; width: number; height: number }>();
  const resolving = new Set<string>();

  const resolveBounds = (nodeId: string): { x: number; y: number; width: number; height: number } | null => {
    const cached = boundsById.get(nodeId);
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
      const parentBounds = resolveBounds(parentId);
      if (parentBounds) {
        absoluteX += parentBounds.x;
        absoluteY += parentBounds.y;
      }
    }

    const resolved = {
      x: absoluteX,
      y: absoluteY,
      width,
      height,
    };
    boundsById.set(nodeId, resolved);
    centerById.set(nodeId, {
      x: absoluteX + width / 2,
      y: absoluteY + height / 2,
    });
    resolving.delete(nodeId);
    return resolved;
  };

  nodeList.forEach((node) => {
    resolveBounds(node.id);
  });

  return { centerById, boundsById };
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

const isPolylineNearViewport = (
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number
): boolean => {
  if (points.length < 2) return false;
  for (let i = 0; i < points.length - 1; i += 1) {
    if (isSegmentNearViewport(points[i]!, points[i + 1]!, width, height)) {
      return true;
    }
  }
  return false;
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

  const nodeGeometry = buildAbsoluteNodeGeometry(props.nodes);
  const nodeCenters = nodeGeometry.centerById;
  const nodeById = new Map(props.nodes.map((node) => [node.id, node]));
  const highlightedEdgeIdSet = new Set(props.highlightedEdgeIds);
  const visibleEdges = props.edges
    .filter((edge) => !edge.hidden && !highlightedEdgeIdSet.has(edge.id))
    .slice(0, props.maxEdges);

  for (const edge of visibleEdges) {
    const sourceAnchor = edge.data?.sourceAnchor as { x: number; y: number } | undefined;
    const targetAnchor = edge.data?.targetAnchor as { x: number; y: number } | undefined;
    const sourceHandle = edge.sourceHandle ?? undefined;
    const targetHandle = edge.targetHandle ?? undefined;
    const sourceBounds = nodeGeometry.boundsById.get(edge.source);
    const targetBounds = nodeGeometry.boundsById.get(edge.target);
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourcePoint = (sourceBounds && sourceHandle ? getHandleAnchor(sourceBounds, sourceHandle) : undefined)
      ?? sourceAnchor
      ?? nodeCenters.get(edge.source);
    const targetPoint = (targetBounds && targetHandle ? getHandleAnchor(targetBounds, targetHandle) : undefined)
      ?? targetAnchor
      ?? nodeCenters.get(edge.target);
    if (!sourcePoint || !targetPoint) {
      continue;
    }

    const polylineOptions = {
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
      ...(sourceNode?.type ? { sourceNodeType: sourceNode.type } : {}),
      ...(targetNode?.type ? { targetNodeType: targetNode.type } : {}),
    };
    const worldPolyline = buildEdgePolyline(sourcePoint, targetPoint, polylineOptions);
    const screenPolyline = worldPolyline.map((point) => toScreenPoint(point, props.viewport));
    if (!isPolylineNearViewport(screenPolyline, width, height)) {
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
    context.moveTo(screenPolyline[0]!.x, screenPolyline[0]!.y);
    for (let i = 1; i < screenPolyline.length; i += 1) {
      const point = screenPolyline[i]!;
      context.lineTo(point.x, point.y);
    }
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
