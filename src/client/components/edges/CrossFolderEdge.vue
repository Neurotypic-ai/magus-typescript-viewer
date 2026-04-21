<script setup lang="ts">
import { computed } from 'vue';

import { BaseEdge, Position, getSmoothStepPath } from '@vue-flow/core';

import { useCycleEdgeStyle } from './useCycleEdgeStyle';

import type { EdgeProps } from '@vue-flow/core';

const props = defineProps<EdgeProps>();

const routeResult = computed(() => {
  // Midpoint-based offset so the vertical segment sits at the midpoint between
  // source and target columns. Edges crossing the same column gap share
  // approximately the same lane X, producing natural visual bundling.
  const offset = 40;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition ?? Position.Right,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition ?? Position.Left,
    offset,
    borderRadius: 12,
  });
  return { path, labelX, labelY };
});

const cycleStyle = useCycleEdgeStyle(
  computed(() => props.source),
  computed(() => props.target),
  computed(() => (props.style ?? undefined) as Record<string, string | number> | undefined)
);
</script>

<template>
  <BaseEdge
    :id="id"
    :path="routeResult.path"
    v-bind="{
      labelX: routeResult.labelX,
      labelY: routeResult.labelY,
      ...(markerStart === undefined ? {} : { markerStart }),
      ...(markerEnd === undefined ? {} : { markerEnd }),
      ...(cycleStyle.style.value === undefined ? {} : { style: cycleStyle.style.value }),
      ...(interactionWidth === undefined ? {} : { interactionWidth }),
    }"
  />
</template>
