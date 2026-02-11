<script setup lang="ts">
import { computed } from 'vue';

import type { DependencyProps } from '../types';

const props = defineProps<DependencyProps>();
const label = computed(() => props.data?.label ?? 'Folder');
</script>

<template>
  <div :class="['group-node-container', { 'group-node-selected': !!props.selected }]">
    <div class="group-node-label" :title="label">{{ label }}</div>
  </div>
</template>

<style scoped>
.group-node-container {
  min-width: 220px;
  min-height: 120px;
  border: 1px dashed rgba(148, 163, 184, 0.6);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.15);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.15);
  overflow: visible;
  padding: 28px 10px 10px 10px;
}

.group-node-selected {
  border-color: rgba(96, 165, 250, 0.9);
  box-shadow:
    inset 0 0 0 1px rgba(96, 165, 250, 0.45),
    0 0 0 2px rgba(96, 165, 250, 0.2);
}

.group-node-label {
  position: absolute;
  top: 8px;
  left: 10px;
  right: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
