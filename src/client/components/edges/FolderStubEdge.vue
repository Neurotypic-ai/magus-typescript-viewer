<script setup lang="ts">
import { computed } from 'vue';

import { BaseEdge, Position, getSmoothStepPath } from '@vue-flow/core';

import { getEdgeStyle } from '../../theme/graphTheme';

import type { EdgeProps } from '@vue-flow/core';
import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';

const props = defineProps<EdgeProps>();

// Stubs always route Right→Left so they travel through the folder interior
// rather than looping outside. Both stub types share this convention:
//   source stub: child-right → folder-right-wall (source is left of target)
//   target stub: folder-left-wall → child-left  (source is left of target)
const routeResult = computed(() => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: Position.Right,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: Position.Left,
    offset: 8,
    borderRadius: 4,
  });
  return { path, labelX, labelY };
});

const edgeStyle = computed(() => {
  const edgeData = props.data as { type?: DependencyEdgeKind } | undefined;
  const type = edgeData?.type;
  const baseStyle = type ? getEdgeStyle(type) : {};
  // Merge props.style so CSS variables (e.g. --edge-hover-base-stroke) set by the
  // hover system are applied to the path element. baseStyle goes first so that
  // explicit type-specific values are the baseline; props.style adds variables on top.
  return props.style ? { ...baseStyle, ...props.style } : baseStyle;
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="routeResult.path"
    :style="edgeStyle"
    v-bind="{
      ...(markerEnd === undefined ? {} : { markerEnd }),
      ...(interactionWidth === undefined ? {} : { interactionWidth }),
    }"
  />
</template>
