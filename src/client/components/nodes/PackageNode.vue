<script setup lang="ts">
import { computed, toRef } from 'vue';

import BaseNode from './BaseNode.vue';
import { buildBaseNodeProps, resolveSubnodesCount } from './utils';

import type { DependencyProps } from '../../types';

const props = defineProps<DependencyProps>();

const nodeData = toRef(props, 'data');
const metadataItems = computed(() => nodeData.value.properties ?? []);
const subnodesResolved = computed(() =>
  resolveSubnodesCount(nodeData.value.subnodes as { count?: number; totalCount?: number } | undefined),
);

const baseNodeProps = computed(() => buildBaseNodeProps(props, {
  isContainer: true,
  showSubnodes: subnodesResolved.value.totalCount > 0,
  subnodesCount: subnodesResolved.value.count,
}));
</script>

<template>
  <BaseNode v-bind="baseNodeProps" badge-text="PACKAGE" :z-index="0" badge-class="package-badge">
    <template #body>
      <div v-if="metadataItems.length > 0" class="package-metadata">
        <div v-for="(prop, index) in metadataItems" :key="`metadata-${prop.name}-${prop.type}-${index}`" class="metadata-item">
          <span class="metadata-name">{{ prop.name }}:</span>
          <span class="metadata-value">{{ prop.type }}</span>
        </div>
      </div>
      <div v-else class="package-empty-state">No package metadata</div>
    </template>

    <template #subnodes>
      <div class="package-subnodes-hint">Contains {{ subnodesResolved.count }} module nodes</div>
    </template>
  </BaseNode>
</template>

<style scoped>
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
