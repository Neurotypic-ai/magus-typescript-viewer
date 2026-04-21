<script setup lang="ts">
import { computed } from 'vue';

import { BaseEdge, getSmoothStepPath } from '@vue-flow/core';

import { useCycleEdgeStyle } from './useCycleEdgeStyle';

import type { EdgeProps } from '@vue-flow/core';

const props = defineProps<EdgeProps>();

const routeResult = computed(() => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    offset: 20,
    borderRadius: 8,
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
