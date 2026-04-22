<script setup lang="ts">
import { computed } from 'vue';

import { BaseEdge } from '@vue-flow/core';

import type { EdgeProps } from '@vue-flow/core';
import type { GraphEdgeData } from '../../../shared/types/graph/GraphEdgeData';

const props = defineProps<EdgeProps>();

/**
 * Fan-in stub edge (MVP): a single straight line from the original source to
 * the trunk junction.  The underlying edge record carries the real target id
 * for hover / selection compatibility, so Vue Flow provides `targetX/Y` at
 * the target's boundary; we override the target coordinate with the junction
 * coordinate recorded on `data.trunkJunctionX/Y` so visually the stub ends
 * at the shared junction rather than at the hub.
 */
const routeResult = computed(() => {
  const data = props.data as GraphEdgeData | undefined;
  const jx = data?.trunkJunctionX;
  const jy = data?.trunkJunctionY;
  const targetX = jx !== undefined && jx !== 0 ? jx : props.targetX;
  const targetY = jy !== undefined && jy !== 0 ? jy : props.targetY;
  const path = `M ${String(props.sourceX)} ${String(props.sourceY)} L ${String(targetX)} ${String(targetY)}`;
  const labelX = (props.sourceX + targetX) / 2;
  const labelY = (props.sourceY + targetY) / 2;
  return { path, labelX, labelY };
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="routeResult.path"
    v-bind="{
      labelX: routeResult.labelX,
      labelY: routeResult.labelY,
      ...(markerEnd === undefined ? {} : { markerEnd }),
      ...(interactionWidth === undefined ? {} : { interactionWidth }),
    }"
  />
</template>
