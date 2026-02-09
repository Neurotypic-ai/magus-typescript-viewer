<script setup lang="ts">
import { computed, ref } from 'vue';

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

// Collapsible sections state
const isMetadataExpanded = ref(true);

const toggleMetadata = () => {
  isMetadataExpanded.value = !isMetadataExpanded.value;
};
</script>

<template>
  <BaseNode v-bind="baseNodeProps" badge-text="MODULE">
    <template #content>
      <!-- Module Metadata Section -->
      <div v-if="nodeData.properties && nodeData.properties.length > 0" class="metadata-section">
        <!-- Collapsible Header -->
        <button
          class="metadata-toggle"
          @click="toggleMetadata"
          type="button"
          :aria-expanded="isMetadataExpanded"
          aria-label="Toggle metadata section"
        >
          <span class="metadata-label">Metadata</span>
          <svg
            class="metadata-icon"
            :class="{ 'metadata-icon-expanded': isMetadataExpanded }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Collapsible Content -->
        <div v-show="isMetadataExpanded" class="metadata-content">
          <div v-for="(prop, index) in nodeData.properties" :key="index" class="metadata-item">
            <span class="metadata-prop-name">{{ prop.name }}:</span>
            <span class="metadata-prop-value" :title="prop.type">{{ prop.type }}</span>
          </div>
        </div>
      </div>
    </template>

    <template #empty>
      <!-- Empty State -->
      <div v-if="!nodeData.properties || nodeData.properties.length === 0" class="empty-state">
        No metadata available
      </div>
    </template>
  </BaseNode>
</template>

<style scoped>
/* Metadata Section */
.metadata-section {
  border-bottom: 1px solid rgba(var(--border-default-rgb), 0.5);
}

.metadata-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  transition: background-color 200ms;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
}

.metadata-toggle:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.metadata-label {
  color: var(--text-secondary);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.metadata-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: var(--text-secondary);
  transition: transform 200ms;
}

.metadata-icon-expanded {
  transform: rotate(180deg);
}

.metadata-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0 1rem 0.75rem 1rem;
  animation:
    fade-in 200ms ease-out,
    slide-in-from-top 200ms ease-out;
}

.metadata-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
  padding: 0.5rem;
  border-radius: 0.25rem;
  transition: background-color 200ms;
}

.metadata-prop-name {
  font-weight: 600;
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 50px;
}

.metadata-prop-value {
  color: var(--text-primary);
  word-break: break-all;
}

/* Empty State */
.empty-state {
  padding: 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1rem;
  font-style: italic;
  opacity: 0.6;
}
</style>
