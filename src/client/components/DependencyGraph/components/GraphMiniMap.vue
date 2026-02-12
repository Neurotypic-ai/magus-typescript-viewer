<script setup lang="ts">
import { Panel, useVueFlow } from '@vue-flow/core';
import { computed, onBeforeUnmount, ref } from 'vue';

import type { DependencyNode, GraphEdge } from '../types';

interface GraphMiniMapProps {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  selectedNodeId?: string | null;
}

const props = withDefaults(defineProps<GraphMiniMapProps>(), {
  selectedNodeId: null,
});
const { setCenter, viewport } = useVueFlow();

const MAX_WIDTH = 220;
const MAX_HEIGHT = 160;
const MIN_SIZE = 80;
const MAP_PADDING = 12;

function parseNodeSize(node: DependencyNode): { width: number; height: number } {
  const style = (typeof node.style === 'object' ? node.style : {}) as Record<string, unknown>;

  const widthStyle = style['width'];
  const heightStyle = style['height'];
  const widthFromStyle = typeof widthStyle === 'string' ? Number.parseFloat(widthStyle) : Number(widthStyle);
  const heightFromStyle = typeof heightStyle === 'string' ? Number.parseFloat(heightStyle) : Number(heightStyle);
  const widthFromNode = typeof node.width === 'number' ? node.width : undefined;
  const heightFromNode = typeof node.height === 'number' ? node.height : undefined;

  return {
    width: Number.isFinite(widthFromStyle) && widthFromStyle > 0 ? widthFromStyle : widthFromNode ?? 180,
    height: Number.isFinite(heightFromStyle) && heightFromStyle > 0 ? heightFromStyle : heightFromNode ?? 120,
  };
}

const nodeBounds = computed(() => {
  if (props.nodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      width: 1,
      height: 1,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  props.nodes.forEach((node) => {
    const { width, height } = parseNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
});

const mapDimensions = computed(() => {
  const aspect = nodeBounds.value.width / Math.max(1, nodeBounds.value.height);
  if (aspect >= 1) {
    const h = Math.max(MIN_SIZE, Math.round(MAX_WIDTH / aspect));
    return { width: MAX_WIDTH, height: Math.min(MAX_HEIGHT, h) };
  }
  const w = Math.max(MIN_SIZE, Math.round(MAX_HEIGHT * aspect));
  return { width: Math.min(MAX_WIDTH, w), height: MAX_HEIGHT };
});

const mapScale = computed(() => {
  const widthScale = (mapDimensions.value.width - MAP_PADDING * 2) / nodeBounds.value.width;
  const heightScale = (mapDimensions.value.height - MAP_PADDING * 2) / nodeBounds.value.height;
  return Math.min(widthScale, heightScale);
});

const normalizedNodes = computed(() => {
  return props.nodes.map((node) => {
    const size = parseNodeSize(node);
    const x = (node.position.x - nodeBounds.value.minX) * mapScale.value + MAP_PADDING;
    const y = (node.position.y - nodeBounds.value.minY) * mapScale.value + MAP_PADDING;

    return {
      id: node.id,
      type: node.type,
      x,
      y,
      width: Math.max(2, size.width * mapScale.value),
      height: Math.max(2, size.height * mapScale.value),
    };
  });
});

const normalizedEdges = computed(() => {
  const nodeMap = new Map(
    normalizedNodes.value.map((node) => [
      node.id,
      {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      },
    ])
  );

  return props.edges
    .filter((edge) => edge.hidden !== true)
    .map((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) {
        return null;
      }

      return {
        id: edge.id,
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
      };
    })
    .filter((edge): edge is { id: string; x1: number; y1: number; x2: number; y2: number } => Boolean(edge));
});

const viewportRect = computed(() => {
  const vp = viewport.value;
  const containerEl = document.querySelector('.vue-flow') as HTMLElement | null;
  const cw = containerEl?.clientWidth ?? window.innerWidth;
  const ch = containerEl?.clientHeight ?? window.innerHeight;
  const scale = mapScale.value;

  return {
    x: (-vp.x / vp.zoom - nodeBounds.value.minX) * scale + MAP_PADDING,
    y: (-vp.y / vp.zoom - nodeBounds.value.minY) * scale + MAP_PADDING,
    width: (cw / vp.zoom) * scale,
    height: (ch / vp.zoom) * scale,
  };
});

function nodeFill(type: string): string {
  if (type === 'package') return 'rgba(20, 184, 166, 0.55)';
  if (type === 'module') return 'rgba(59, 130, 246, 0.5)';
  if (type === 'class' || type === 'interface') return 'rgba(217, 119, 6, 0.45)';
  return 'rgba(148, 163, 184, 0.4)';
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toGraphPosition(mapX: number, mapY: number): { x: number; y: number } {
  const scale = mapScale.value || 1;
  const graphX = (mapX - MAP_PADDING) / scale + nodeBounds.value.minX;
  const graphY = (mapY - MAP_PADDING) / scale + nodeBounds.value.minY;
  return {
    x: Number.isFinite(graphX) ? graphX : nodeBounds.value.minX,
    y: Number.isFinite(graphY) ? graphY : nodeBounds.value.minY,
  };
}

function handleMapClick(event: MouseEvent): void {
  const svg = event.currentTarget as SVGElement | null;
  if (!svg) {
    return;
  }

  const rect = svg.getBoundingClientRect();
  const localX = clamp(event.clientX - rect.left, 0, mapDimensions.value.width);
  const localY = clamp(event.clientY - rect.top, 0, mapDimensions.value.height);
  const position = toGraphPosition(localX, localY);
  void setCenter(position.x, position.y, {
    duration: 180,
    zoom: viewport.value.zoom,
  });
}

function centerOnNode(nodeId: string): void {
  const targetNode = props.nodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  const size = parseNodeSize(targetNode);
  const centerX = targetNode.position.x + size.width / 2;
  const centerY = targetNode.position.y + size.height / 2;
  void setCenter(centerX, centerY, {
    duration: 180,
    zoom: viewport.value.zoom,
  });
}

// --- Viewport drag handling ---
const isDraggingViewport = ref(false);
let dragStartMapX = 0;
let dragStartMapY = 0;
let dragStartViewportX = 0;
let dragStartViewportY = 0;

function handleViewportDragStart(event: MouseEvent): void {
  event.preventDefault();
  isDraggingViewport.value = true;

  const svg = (event.currentTarget as SVGElement).closest('svg');
  if (!svg) return;
  const svgRect = svg.getBoundingClientRect();
  dragStartMapX = event.clientX - svgRect.left;
  dragStartMapY = event.clientY - svgRect.top;
  dragStartViewportX = viewportRect.value.x;
  dragStartViewportY = viewportRect.value.y;

  window.addEventListener('mousemove', handleViewportDragMove);
  window.addEventListener('mouseup', handleViewportDragEnd);
}

function handleViewportDragMove(event: MouseEvent): void {
  if (!isDraggingViewport.value) return;

  const svg = document.querySelector('.graph-mini-map-svg') as SVGElement | null;
  if (!svg) return;
  const svgRect = svg.getBoundingClientRect();
  const currentMapX = event.clientX - svgRect.left;
  const currentMapY = event.clientY - svgRect.top;

  const dx = currentMapX - dragStartMapX;
  const dy = currentMapY - dragStartMapY;

  const newCenterMapX = clamp(
    dragStartViewportX + dx + viewportRect.value.width / 2,
    0,
    mapDimensions.value.width
  );
  const newCenterMapY = clamp(
    dragStartViewportY + dy + viewportRect.value.height / 2,
    0,
    mapDimensions.value.height
  );

  const position = toGraphPosition(newCenterMapX, newCenterMapY);
  void setCenter(position.x, position.y, {
    duration: 0,
    zoom: viewport.value.zoom,
  });
}

function handleViewportDragEnd(): void {
  isDraggingViewport.value = false;
  window.removeEventListener('mousemove', handleViewportDragMove);
  window.removeEventListener('mouseup', handleViewportDragEnd);
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleViewportDragMove);
  window.removeEventListener('mouseup', handleViewportDragEnd);
});
</script>

<template>
  <Panel position="bottom-right" class="mb-2 mr-2">
    <div class="graph-mini-map" :style="{ width: mapDimensions.width + 16 + 'px' }">
      <div class="graph-mini-map-title">Mini-map</div>
      <svg
        :width="mapDimensions.width"
        :height="mapDimensions.height"
        class="graph-mini-map-svg"
        @click="handleMapClick"
      >
        <line
          v-for="edge in normalizedEdges"
          :key="edge.id"
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          stroke="rgba(148, 163, 184, 0.45)"
          stroke-width="1"
        />
        <rect
          v-for="node in normalizedNodes"
          :key="node.id"
          :x="node.x"
          :y="node.y"
          :width="node.width"
          :height="node.height"
          :fill="nodeFill(node.type ?? '')"
          :stroke="node.id === selectedNodeId ? '#22d3ee' : 'rgba(226, 232, 240, 0.5)'"
          :stroke-width="node.id === selectedNodeId ? 1.5 : 0.8"
          rx="1.5"
          role="button"
          @click.stop="centerOnNode(node.id)"
        />
        <rect
          v-if="viewportRect"
          :x="viewportRect.x"
          :y="viewportRect.y"
          :width="viewportRect.width"
          :height="viewportRect.height"
          fill="rgba(34, 211, 238, 0.08)"
          stroke="rgba(34, 211, 238, 0.6)"
          stroke-width="1.5"
          stroke-dasharray="3 2"
          rx="2"
          class="viewport-indicator"
          @mousedown.stop="handleViewportDragStart"
        />
      </svg>
    </div>
  </Panel>
</template>

<style scoped>
.graph-mini-map {
  background: rgba(7, 10, 18, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  padding: 8px;
  backdrop-filter: blur(4px);
}

.graph-mini-map-title {
  color: rgba(226, 232, 240, 0.9);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.graph-mini-map-svg {
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
  cursor: pointer;
}

.viewport-indicator {
  cursor: grab;
  pointer-events: all;
}

.viewport-indicator:active {
  cursor: grabbing;
}
</style>
