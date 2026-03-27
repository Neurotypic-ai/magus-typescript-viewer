<script setup lang="ts">
import { computed } from 'vue';

import { BaseEdge, getSmoothStepPath } from '@vue-flow/core';

import { getEdgeStyle } from '../../theme/graphTheme';

import type { EdgeProps } from '@vue-flow/core';
import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';

const props = defineProps<EdgeProps>();

const routeResult = computed(() => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    offset: 8,
    borderRadius: 4,
  });
  return { path, labelX, labelY };
});

const edgeStyle = computed(() => {
  const edgeData = props.data as { type?: DependencyEdgeKind } | undefined;
  const type = edgeData?.type;
  const base = type ? getEdgeStyle(type) : {};
  return {
    ...base,
    strokeWidth: 0.75,
    opacity: 0.4,
    strokeDasharray: '4 3',
  };
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="routeResult.path"
    :style="edgeStyle"
    v-bind="interactionWidth === undefined ? {} : { interactionWidth }"
  />
</template>
