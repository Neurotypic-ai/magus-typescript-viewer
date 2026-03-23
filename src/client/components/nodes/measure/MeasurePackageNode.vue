<script setup lang="ts">
import { computed } from 'vue';

import MeasureBaseNode from './MeasureBaseNode.vue';
import { resolveSubnodesCount } from '../utils';

import type { DependencyData } from '../../../../shared/types/graph/DependencyData';
import type { DependencyNode } from '../../../types/DependencyNode';

interface MeasurePackageNodeProps {
  node: DependencyNode;
}

const props = defineProps<MeasurePackageNodeProps>();

const nodeData = computed<Partial<DependencyData> & { label: string }>(() => ({
  label: props.node.id,
  ...(props.node.data ?? {}),
}));
const metadataItems = computed(() => nodeData.value.properties ?? []);
const subnodesResolved = computed(() =>
  resolveSubnodesCount(nodeData.value.subnodes as { count?: number; totalCount?: number } | undefined)
);
const surfaceStyle = computed(() =>
  props.node.style && typeof props.node.style === 'object' && !Array.isArray(props.node.style)
    ? (props.node.style as Record<string, string | number>)
    : undefined
);
</script>

<template>
  <MeasureBaseNode
    :label="nodeData.label"
    badge-text="PACKAGE"
    badge-class="package-badge"
    :surface-style="surfaceStyle"
    :is-container="true"
    :show-subnodes="subnodesResolved.totalCount > 0"
    :subnodes-count="subnodesResolved.totalCount"
  >
    <template #body>
      <div v-if="metadataItems.length > 0" class="package-metadata">
        <div
          v-for="(prop, index) in metadataItems"
          :key="`metadata-${prop.name}-${prop.type}-${index}`"
          class="metadata-item"
        >
          <span class="metadata-name">{{ prop.name }}:</span>
          <span class="metadata-value">{{ prop.type }}</span>
        </div>
      </div>
      <div v-else class="package-empty-state">No package metadata</div>
    </template>

    <template #subnodes>
      <div class="package-subnodes-hint">Contains {{ subnodesResolved.count }} module nodes</div>
    </template>
  </MeasureBaseNode>
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
