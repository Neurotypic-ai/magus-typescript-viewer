<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@vue-flow/core';
import { findObstacleAwarePath } from '../../layout/orthogonalPathfinder';
import { useIntraFolderObstacleIndex } from '../../composables/useIntraFolderObstacleIndex';

const props = defineProps<EdgeProps>();
const obstacleIndex = useIntraFolderObstacleIndex();

const ENABLE_OBSTACLE_AWARE =
  import.meta.env['VITE_OBSTACLE_AWARE_INTRA_FOLDER_EDGES'] !== 'false';

const routeResult = computed(() => {
  const folderId = props.sourceNode?.parentNode ?? props.targetNode?.parentNode;
  if (!folderId) return { path: null, labelX: undefined, labelY: undefined, status: 'not-measured' as const };

  const snapshot = obstacleIndex.getSnapshot(folderId);
  if (!snapshot || !snapshot.ready) {
    return { path: null, labelX: undefined, labelY: undefined, status: 'not-measured' as const };
  }

  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const obstacles = snapshot.obstacles
    .filter((o) => o.nodeId !== props.source && o.nodeId !== props.target)
    .map(({ nodeId: _nodeId, ...rect }) => rect);
  const result = findObstacleAwarePath(source, target, obstacles);

  if (result.path) {
    return {
      path: result.path,
      labelX: result.labelPoint?.x,
      labelY: result.labelPoint?.y,
      status: result.status,
    };
  }

  if (!ENABLE_OBSTACLE_AWARE) {
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
    return { path, labelX, labelY, status: 'no-route' as const };
  }

  return { path: null, labelX: undefined, labelY: undefined, status: result.status };
});

const optionalEdgeProps = computed(() => {
  const result: Record<string, unknown> = {};
  const { labelX, labelY } = routeResult.value;
  if (labelX !== undefined) result['labelX'] = labelX;
  if (labelY !== undefined) result['labelY'] = labelY;
  if (props.style !== undefined) result['style'] = props.style;
  if (props.interactionWidth !== undefined) result['interactionWidth'] = props.interactionWidth;
  return result;
});
</script>

<template>
  <BaseEdge
    v-if="routeResult.path"
    :id="id"
    :path="routeResult.path"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    v-bind="optionalEdgeProps"
  />
</template>
