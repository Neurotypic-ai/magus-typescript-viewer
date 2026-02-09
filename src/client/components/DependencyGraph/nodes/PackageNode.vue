<script setup lang="ts">
import { computed } from 'vue';

import BaseNode from './BaseNode.vue';

import type { DependencyProps } from '../types';

const props = defineProps<DependencyProps>();

const baseNodeProps = computed(() => ({
  id: props.id,
  type: props.type,
  data: props.data,
  ...(props.selected !== undefined ? { selected: props.selected } : {}),
  ...(props.width !== undefined ? { width: props.width } : {}),
  ...(props.height !== undefined ? { height: props.height } : {}),
  ...(props.sourcePosition !== undefined ? { sourcePosition: props.sourcePosition } : {}),
  ...(props.targetPosition !== undefined ? { targetPosition: props.targetPosition } : {}),
}));

const nodeData = computed(() => props.data);
</script>

<template>
  <BaseNode v-bind="baseNodeProps" badge-text="PACKAGE" :z-index="0" badge-class="package-badge">
    <template #content>
      <!-- Package Metadata -->
      <div v-if="nodeData.properties && nodeData.properties.length > 0" class="package-metadata">
        <div v-for="(prop, index) in nodeData.properties" :key="index" class="metadata-item">
          <span class="metadata-name">{{ prop.name }}:</span>
          <span class="metadata-value">{{ prop.type }}</span>
        </div>
      </div>
    </template>
  </BaseNode>
</template>

<style scoped>
/* Package-specific badge styling */
.package-badge {
  background-color: var(--background-node-package);
}

/* Package Metadata */
.package-metadata {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
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
</style>
