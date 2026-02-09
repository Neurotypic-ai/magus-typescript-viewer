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

// Make sure data exists and has the required properties
const nodeData = computed(() => props.data);
const nodeType = computed(() => props.type);

// Compute visibility color class
const getVisibilityColor = (visibility: string) => {
  if (visibility === 'public') return 'visibility-public';
  if (visibility === 'protected') return 'visibility-protected';
  return 'visibility-private';
};

// Compute z-index based on node type
const nodeZIndex = computed(() => {
  switch (nodeType.value) {
    case 'package':
      return 5;
    case 'module':
      return 4;
    case 'class':
    case 'interface':
      return 3;
    default:
      return 1;
  }
});

// Badge text is the node type uppercased
const badgeText = computed(() => String(nodeType.value).toUpperCase());
</script>

<template>
  <BaseNode v-bind="baseNodeProps" :badge-text="badgeText" :z-index="nodeZIndex">
    <template #content>
      <!-- Node Content -->
      <div class="node-content">
        <!-- Properties Section -->
        <div v-if="nodeData.properties && nodeData.properties.length > 0" class="section">
          <div class="section-header">Properties</div>
          <div v-for="(prop, index) in nodeData.properties" :key="index" class="section-item">
            <span v-if="prop.visibility" :class="['visibility-indicator', getVisibilityColor(prop.visibility)]"></span>
            <span class="section-item-text">{{ prop.name }}: {{ prop.type }}</span>
          </div>
        </div>

        <!-- Methods Section -->
        <div v-if="nodeData.methods && nodeData.methods.length > 0" class="section">
          <div class="section-header">Methods</div>
          <div v-for="(method, index) in nodeData.methods" :key="index" class="section-item">
            <span v-if="method.visibility"
              :class="['visibility-indicator', getVisibilityColor(method.visibility)]"></span>
            <span class="section-item-text">{{ method.name }}(): {{ method.returnType }}</span>
          </div>
        </div>
      </div>
    </template>
  </BaseNode>
</template>

<style scoped>
/* Node Content */
.node-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

/* Section */
.section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-header {
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 700;
  text-transform: uppercase;
}

.section-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1rem;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  transition: all 150ms ease-in-out;
}

.section-item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Visibility Indicators */
.visibility-indicator {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  flex-shrink: 0;
}

.visibility-public {
  background-color: var(--visibility-public);
}

.visibility-protected {
  background-color: var(--visibility-protected);
}

.visibility-private {
  background-color: var(--visibility-private);
}
</style>
