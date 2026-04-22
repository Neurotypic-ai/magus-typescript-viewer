<script setup lang="ts">
import { computed } from 'vue';

import { BaseEdge } from '@vue-flow/core';

import type { EdgeProps } from '@vue-flow/core';
import type { GraphEdgeData } from '../../../shared/types/graph/GraphEdgeData';

const props = defineProps<EdgeProps>();

/**
 * Fan-in trunk edge (MVP): a single straight line from the stored junction
 * coordinate to the target.  `bundleFanInTrunks` fixes both endpoints of the
 * trunk to `target.id`, which means Vue Flow hands us `sourceX === targetX`
 * and `sourceY === targetY`.  We replace the source coordinate with the
 * junction coordinate recorded on `data.trunkJunctionX/Y` — if those fields
 * are absent (they can be zero when the bundler runs before positions are
 * assigned) we fall back to the provided source coordinate, which keeps the
 * edge drawable even in a degenerate state.
 */
const routeResult = computed(() => {
  const data = props.data as GraphEdgeData | undefined;
  const jx = data?.trunkJunctionX;
  const jy = data?.trunkJunctionY;
  const sourceX = jx !== undefined && jx !== 0 ? jx : props.sourceX;
  const sourceY = jy !== undefined && jy !== 0 ? jy : props.sourceY;
  const path = `M ${String(sourceX)} ${String(sourceY)} L ${String(props.targetX)} ${String(props.targetY)}`;
  const labelX = (sourceX + props.targetX) / 2;
  const labelY = (sourceY + props.targetY) / 2;
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
