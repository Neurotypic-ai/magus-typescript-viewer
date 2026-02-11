<script setup lang="ts">
import { computed } from 'vue';

import BaseNode from './BaseNode.vue';

import type { DependencyProps } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);
const metadataItems = computed(() => nodeData.value.properties ?? []);
const subnodeCount = computed(() => {
  const count = (nodeData.value.subnodes as { count?: number } | undefined)?.count;
  return typeof count === 'number' ? count : 0;
});

const baseNodeProps = computed(() => ({
  id: props.id,
  type: props.type,
  data: props.data,
  ...(props.selected !== undefined ? { selected: props.selected } : {}),
  ...(props.width !== undefined ? { width: props.width } : {}),
  ...(props.height !== undefined ? { height: props.height } : {}),
  ...(props.sourcePosition !== undefined ? { sourcePosition: props.sourcePosition } : {}),
  ...(props.targetPosition !== undefined ? { targetPosition: props.targetPosition } : {}),
  isContainer: true,
  showSubnodes: true,
  subnodesCount: subnodeCount.value,
}));
</script>

<template>
  <BaseNode v-bind="baseNodeProps" badge-text="PACKAGE" :z-index="0" badge-class="package-badge">
    <template #body>
      <div v-if="metadataItems.length > 0" class="package-metadata">
        <div v-for="(prop, index) in metadataItems" :key="index" class="metadata-item">
          <span class="metadata-name">{{ prop.name }}:</span>
          <span class="metadata-value">{{ prop.type }}</span>
        </div>
      </div>
      <div v-else class="package-empty-state">No package metadata</div>
    </template>

    <template #subnodes>
      <div class="package-subnodes-hint">Contains {{ subnodeCount }} module nodes</div>
    </template>
  </BaseNode>
</template>

<style scoped>
.package-badge {
  background-color: var(--background-node-package);
}

.package-metadata {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metadata-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1rem;
}

.metadata-name {
  font-weight: 600;
}

.metadata-value {
  color: var(--text-secondary);
}

.package-empty-state,
.package-subnodes-hint {
  color: var(--text-secondary);
  font-size: 0.7rem;
  opacity: 0.8;
}
</style>
