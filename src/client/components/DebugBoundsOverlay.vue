<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue';

import { buildAbsoluteNodeBoundsMap, getBoundsCenter } from '../layout/geometryBounds';
import { getHandleAnchor } from '../layout/handleAnchors';

import type { Rect } from '../layout/geometryBounds';
import type { CollisionConfig } from '../layout/collisionResolver';
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
});

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 100;

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

/**
 * Non-reactive snapshot of absolute node bounds. Updated via requestAnimationFrame
 * to break the synchronous reactive chain between VueFlow's updateNodeDimensions
 * (which mutates node.measured) and this overlay's render cycle.
 */
const absoluteBoundsById = shallowRef<Map<string, Rect>>(new Map());
let boundsRafId: number | null = null;

const refreshBounds = (): void => {
  absoluteBoundsById.value = buildAbsoluteNodeBoundsMap(props.nodes, {
    defaultNodeWidth: DEFAULT_NODE_WIDTH,
    defaultNodeHeight: DEFAULT_NODE_HEIGHT,
  });
};

const scheduleBoundsRefresh = (): void => {
  if (boundsRafId !== null) return;
  boundsRafId = requestAnimationFrame(() => {
    boundsRafId = null;
    refreshBounds();
  });
};

watch(() => props.nodes, scheduleBoundsRefresh, { flush: 'post' });
watch(
  () => [props.viewport.x, props.viewport.y, props.viewport.zoom],
  scheduleBoundsRefresh,
  { flush: 'post' },
);

refreshBounds();

onUnmounted(() => {
  if (boundsRafId !== null) {
    cancelAnimationFrame(boundsRafId);
  }
});

const debugEnabled = computed(() => props.showBounds || props.showHandles || props.showNodeIds);

const screenRects = computed<ScreenRect[]>(() => {
  if (!props.showBounds) {
    return [];
  }
  const rects: ScreenRect[] = [];
  const groupPadding = props.collisionConfig.groupPadding;
  const bounds = absoluteBoundsById.value;

  for (const node of props.nodes) {
    const nodeBounds = bounds.get(node.id);
    if (!nodeBounds) {
      continue;
    }
    const outerRect = toScreenRect(nodeBounds);

    if (node.type === 'group') {
      rects.push({
        key: `${node.id}-group-outer`,
        ...outerRect,
        kind: 'groupOuter',
      });

      const interiorWorld = {
        x: nodeBounds.x + groupPadding.horizontal,
        y: nodeBounds.y + groupPadding.top,
        width: Math.max(1, nodeBounds.width - groupPadding.horizontal * 2),
        height: Math.max(1, nodeBounds.height - groupPadding.top - groupPadding.bottom),
      };
      const interiorRect = toScreenRect(interiorWorld);
      rects.push({
        key: `${node.id}-group-inner`,
        ...interiorRect,
        kind: 'groupInner',
      });
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
  const bounds = absoluteBoundsById.value;
  for (const edge of props.edges) {
    const sourceBounds = bounds.get(edge.source);
    if (sourceBounds && edge.sourceHandle) {
      const sourceAnchor = getHandleAnchor(sourceBounds, edge.sourceHandle);
      if (!sourceAnchor) {
        continue;
      }
      const sourcePoint = toScreenPoint(sourceAnchor);
      points.push({
        key: `${edge.id}-source-${edge.sourceHandle}`,
        x: sourcePoint.x,
        y: sourcePoint.y,
        kind: 'source',
      });
    }

    const targetBounds = bounds.get(edge.target);
    if (targetBounds && edge.targetHandle) {
      const targetAnchor = getHandleAnchor(targetBounds, edge.targetHandle);
      if (!targetAnchor) {
        continue;
      }
      const targetPoint = toScreenPoint(targetAnchor);
      points.push({
        key: `${edge.id}-target-${edge.targetHandle}`,
        x: targetPoint.x,
        y: targetPoint.y,
        kind: 'target',
      });
    }
  }

  return points;
});

const nodeLabels = computed<ScreenLabel[]>(() => {
  if (!props.showNodeIds) {
    return [];
  }

  const labels: ScreenLabel[] = [];
  const bounds = absoluteBoundsById.value;
  for (const node of props.nodes) {
    const nodeBounds = bounds.get(node.id);
    if (!nodeBounds) {
      continue;
    }
    const center = toScreenPoint(getBoundsCenter(nodeBounds));
    labels.push({
      key: `${node.id}-label`,
      id: node.id,
      x: center.x,
      y: center.y,
    });
  }
  return labels;
});
</script>

<template>
  <div class="debug-bounds-overlay" aria-hidden="true">
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

  </div>
</template>

<style scoped>
.debug-bounds-overlay {
  position: absolute;
  inset: 0;
  z-index: 12;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
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

</style>
