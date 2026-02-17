<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { buildAbsoluteNodeBoundsMap, getBoundsCenter } from '../layout/geometryBounds';
import { getHandleAnchor } from '../layout/handleAnchors';

import type { CollisionConfig, CollisionResult } from '../layout/collisionResolver';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface DebugBoundsOverlayProps {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  viewport: ViewportState;
  showBounds?: boolean;
  showHandles?: boolean;
  showNodeIds?: boolean;
  collisionConfig: CollisionConfig;
  lastCollisionResult?: CollisionResult | null;
}

interface ScreenRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'nodeOuter' | 'groupOuter' | 'groupInner';
}

interface ScreenPoint {
  key: string;
  x: number;
  y: number;
  kind: 'source' | 'target';
}

interface ScreenLabel {
  key: string;
  id: string;
  x: number;
  y: number;
}

const props = withDefaults(defineProps<DebugBoundsOverlayProps>(), {
  showBounds: false,
  showHandles: false,
  showNodeIds: false,
  lastCollisionResult: null,
});

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 100;
const VIEWPORT_PADDING_PX = 140;

const containerRef = ref<HTMLElement | null>(null);
const containerSize = ref({ width: 0, height: 0 });
let resizeObserver: ResizeObserver | null = null;

const updateContainerSize = (): void => {
  const container = containerRef.value;
  if (!container) {
    containerSize.value = { width: 0, height: 0 };
    return;
  }
  containerSize.value = {
    width: Math.max(0, container.clientWidth),
    height: Math.max(0, container.clientHeight),
  };
};

const toScreenPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
  x: point.x * props.viewport.zoom + props.viewport.x,
  y: point.y * props.viewport.zoom + props.viewport.y,
});

const toScreenRect = (rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  const topLeft = toScreenPoint({ x: rect.x, y: rect.y });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * props.viewport.zoom,
    height: rect.height * props.viewport.zoom,
  };
};

const isRectNearViewport = (
  rect: { x: number; y: number; width: number; height: number },
  padding = VIEWPORT_PADDING_PX
): boolean => {
  const { width, height } = containerSize.value;
  return !(
    rect.x + rect.width < -padding ||
    rect.x > width + padding ||
    rect.y + rect.height < -padding ||
    rect.y > height + padding
  );
};

const isPointNearViewport = (point: { x: number; y: number }, padding = VIEWPORT_PADDING_PX): boolean => {
  const { width, height } = containerSize.value;
  return !(
    point.x < -padding ||
    point.x > width + padding ||
    point.y < -padding ||
    point.y > height + padding
  );
};

const absoluteBoundsById = computed(() =>
  buildAbsoluteNodeBoundsMap(props.nodes, {
    defaultNodeWidth: DEFAULT_NODE_WIDTH,
    defaultNodeHeight: DEFAULT_NODE_HEIGHT,
  })
);

const debugEnabled = computed(() => props.showBounds || props.showHandles || props.showNodeIds);

const screenRects = computed<ScreenRect[]>(() => {
  if (!props.showBounds) {
    return [];
  }
  const rects: ScreenRect[] = [];
  const groupPadding = props.collisionConfig.groupPadding;

  for (const node of props.nodes) {
    const bounds = absoluteBoundsById.value.get(node.id);
    if (!bounds) {
      continue;
    }
    const outerRect = toScreenRect(bounds);
    if (!isRectNearViewport(outerRect)) {
      continue;
    }

    if (node.type === 'group') {
      rects.push({
        key: `${node.id}-group-outer`,
        ...outerRect,
        kind: 'groupOuter',
      });

      const interiorWorld = {
        x: bounds.x + groupPadding.horizontal,
        y: bounds.y + groupPadding.top,
        width: Math.max(1, bounds.width - groupPadding.horizontal * 2),
        height: Math.max(1, bounds.height - groupPadding.top - groupPadding.bottom),
      };
      const interiorRect = toScreenRect(interiorWorld);
      if (isRectNearViewport(interiorRect)) {
        rects.push({
          key: `${node.id}-group-inner`,
          ...interiorRect,
          kind: 'groupInner',
        });
      }
      continue;
    }

    rects.push({
      key: `${node.id}-node-outer`,
      ...outerRect,
      kind: 'nodeOuter',
    });
  }

  return rects;
});

const handlePoints = computed<ScreenPoint[]>(() => {
  if (!props.showHandles) {
    return [];
  }

  const points: ScreenPoint[] = [];
  for (const edge of props.edges) {
    const sourceBounds = absoluteBoundsById.value.get(edge.source);
    if (sourceBounds && edge.sourceHandle) {
      const sourceAnchor = getHandleAnchor(sourceBounds, edge.sourceHandle);
      if (!sourceAnchor) {
        continue;
      }
      const sourcePoint = toScreenPoint(sourceAnchor);
      if (isPointNearViewport(sourcePoint)) {
        points.push({
          key: `${edge.id}-source-${edge.sourceHandle}`,
          x: sourcePoint.x,
          y: sourcePoint.y,
          kind: 'source',
        });
      }
    }

    const targetBounds = absoluteBoundsById.value.get(edge.target);
    if (targetBounds && edge.targetHandle) {
      const targetAnchor = getHandleAnchor(targetBounds, edge.targetHandle);
      if (!targetAnchor) {
        continue;
      }
      const targetPoint = toScreenPoint(targetAnchor);
      if (isPointNearViewport(targetPoint)) {
        points.push({
          key: `${edge.id}-target-${edge.targetHandle}`,
          x: targetPoint.x,
          y: targetPoint.y,
          kind: 'target',
        });
      }
    }
  }

  return points;
});

const nodeLabels = computed<ScreenLabel[]>(() => {
  if (!props.showNodeIds) {
    return [];
  }

  const labels: ScreenLabel[] = [];
  for (const node of props.nodes) {
    const bounds = absoluteBoundsById.value.get(node.id);
    if (!bounds) {
      continue;
    }
    const center = toScreenPoint(getBoundsCenter(bounds));
    if (!isPointNearViewport(center)) {
      continue;
    }
    labels.push({
      key: `${node.id}-label`,
      id: node.id,
      x: center.x,
      y: center.y,
    });
  }
  return labels;
});

onMounted(() => {
  updateContainerSize();
  if (!containerRef.value) {
    return;
  }
  resizeObserver = new ResizeObserver(() => {
    updateContainerSize();
  });
  resizeObserver.observe(containerRef.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="containerRef" class="debug-bounds-overlay" aria-hidden="true">
    <svg v-if="debugEnabled" class="debug-bounds-svg">
      <rect
        v-for="rect in screenRects"
        :key="rect.key"
        :x="rect.x"
        :y="rect.y"
        :width="rect.width"
        :height="rect.height"
        :fill="
          rect.kind === 'groupInner'
            ? 'rgba(34, 211, 238, 0.08)'
            : rect.kind === 'groupOuter'
              ? 'rgba(56, 189, 248, 0.08)'
              : 'rgba(250, 204, 21, 0.06)'
        "
        :stroke="
          rect.kind === 'groupInner'
            ? 'rgba(34, 211, 238, 0.95)'
            : rect.kind === 'groupOuter'
              ? 'rgba(56, 189, 248, 0.95)'
              : 'rgba(250, 204, 21, 0.95)'
        "
        :stroke-dasharray="rect.kind === 'groupInner' ? '6 4' : '0'"
        stroke-width="1.25"
      />
      <circle
        v-for="point in handlePoints"
        :key="point.key"
        :cx="point.x"
        :cy="point.y"
        r="3.5"
        :fill="point.kind === 'source' ? 'rgba(52, 211, 153, 0.95)' : 'rgba(248, 113, 113, 0.95)'"
        stroke="rgba(15, 23, 42, 0.95)"
        stroke-width="1"
      />
      <text
        v-for="label in nodeLabels"
        :key="label.key"
        :x="label.x"
        :y="label.y"
        class="debug-node-label"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {{ label.id }}
      </text>
    </svg>

    <div v-if="debugEnabled && lastCollisionResult" class="debug-collision-badge">
      <span>cycles: {{ lastCollisionResult.cyclesUsed }}</span>
      <span>converged: {{ lastCollisionResult.converged ? 'yes' : 'no' }}</span>
      <span>moved: {{ lastCollisionResult.updatedPositions.size }}</span>
      <span>resized: {{ lastCollisionResult.updatedSizes.size }}</span>
    </div>
  </div>
</template>

<style scoped>
.debug-bounds-overlay {
  position: absolute;
  inset: 0;
  z-index: 12;
  pointer-events: none;
}

.debug-bounds-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.debug-node-label {
  fill: rgba(226, 232, 240, 0.95);
  stroke: rgba(15, 23, 42, 0.95);
  stroke-width: 0.25px;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.debug-collision-badge {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: inline-flex;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(15, 23, 42, 0.72);
  color: rgba(226, 232, 240, 0.95);
  font-size: 10px;
  line-height: 1.1;
}
</style>
