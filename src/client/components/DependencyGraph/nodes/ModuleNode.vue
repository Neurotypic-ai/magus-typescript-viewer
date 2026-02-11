<script setup lang="ts">
import { computed, ref } from 'vue';

import BaseNode from './BaseNode.vue';

import type { DependencyProps, ExternalDependencyRef } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);

const metadataItems = computed(() => nodeData.value.properties ?? []);
const externalDependencies = computed<ExternalDependencyRef[]>(() => {
  const metadata = nodeData.value.externalDependencies;
  return Array.isArray(metadata) ? metadata : [];
});

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

const showMetadata = ref(true);
const showExternalDeps = ref(true);
</script>

<template>
  <BaseNode v-bind="baseNodeProps" badge-text="MODULE">
    <template #body>
      <div v-if="metadataItems.length > 0" class="module-section">
        <button class="module-section-toggle" type="button" @click="showMetadata = !showMetadata">
          <span>Metadata</span>
          <span>{{ showMetadata ? '−' : '+' }}</span>
        </button>
        <div v-if="showMetadata" class="module-section-content">
          <div v-for="(prop, index) in metadataItems" :key="`metadata-${index}`" class="metadata-item">
            <span class="metadata-key">{{ prop.name }}:</span>
            <span class="metadata-value" :title="prop.type">{{ prop.type }}</span>
          </div>
        </div>
      </div>

      <div v-if="externalDependencies.length > 0" class="module-section">
        <button class="module-section-toggle" type="button" @click="showExternalDeps = !showExternalDeps">
          <span>External Dependencies</span>
          <span>{{ showExternalDeps ? '−' : '+' }}</span>
        </button>
        <div v-if="showExternalDeps" class="module-section-content">
          <div
            v-for="dependency in externalDependencies"
            :key="dependency.packageName"
            class="external-dependency"
          >
            <div class="external-dependency-name">{{ dependency.packageName }}</div>
            <div class="external-dependency-symbols">{{ dependency.symbols.join(', ') }}</div>
          </div>
        </div>
      </div>

      <div v-if="metadataItems.length === 0 && externalDependencies.length === 0" class="module-empty-state">
        No module metadata
      </div>
    </template>

    <template #subnodes>
      <div v-if="subnodeCount > 0" class="subnode-hint">
        Child class/interface nodes are laid out in this module container.
      </div>
      <div v-else class="subnode-hint">No class/interface subnodes for current filters.</div>
    </template>
  </BaseNode>
</template>

<style scoped>
.module-section + .module-section {
  margin-top: 0.5rem;
}

.module-section-toggle {
  width: 100%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.55rem;
  cursor: pointer;
}

.module-section-content {
  margin-top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.metadata-item {
  display: flex;
  gap: 0.4rem;
  font-size: 0.72rem;
}

.metadata-key {
  color: var(--text-secondary);
  font-weight: 600;
  min-width: 58px;
}

.metadata-value {
  color: var(--text-primary);
  word-break: break-word;
}

.external-dependency {
  padding: 0.35rem 0.45rem;
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.03);
}

.external-dependency-name {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 0.72rem;
}

.external-dependency-symbols {
  color: var(--text-secondary);
  font-size: 0.68rem;
  line-height: 1.1;
  margin-top: 0.15rem;
  word-break: break-word;
}

.module-empty-state,
.subnode-hint {
  color: var(--text-secondary);
  font-size: 0.7rem;
  opacity: 0.8;
}
</style>
