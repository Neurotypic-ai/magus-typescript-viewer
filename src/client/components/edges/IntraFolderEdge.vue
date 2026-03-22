<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@vue-flow/core';

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
</script>

<template>
  <BaseEdge
    :id="id"
    :path="routeResult.path"
    v-bind="
      {
        labelX: routeResult.labelX,
        labelY: routeResult.labelY,
        ...(markerStart === undefined ? {} : { markerStart }),
        ...(markerEnd === undefined ? {} : { markerEnd }),
        ...(style === undefined ? {} : { style }),
        ...(interactionWidth === undefined ? {} : { interactionWidth }),
      }
    "
  />
</template>
