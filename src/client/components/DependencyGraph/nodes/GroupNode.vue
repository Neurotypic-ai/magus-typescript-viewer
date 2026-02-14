<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed, inject } from 'vue';

import type { DependencyProps } from '../types';

import { FOLDER_COLLAPSE_ACTIONS_KEY } from './utils';

const props = defineProps<DependencyProps>();
const folderActions = inject(FOLDER_COLLAPSE_ACTIONS_KEY, undefined);

const label = computed(() => props.data?.label ?? 'Folder');
const isCollapsed = computed(() => props.data?.['isCollapsed'] === true);
const childCount = computed(() => (props.data?.['childCount'] as number | undefined) ?? 0);

const displayLabel = computed(() => {
  if (isCollapsed.value && childCount.value > 0) {
    return `${label.value} (${childCount.value})`;
  }
  return label.value;
});

function toggleCollapse() {
  folderActions?.toggleFolderCollapsed(props.id);
}
</script>

<template>
  <div
    :class="[
      'group-node-container',
      { 'group-node-selected': !!props.selected, 'group-node-collapsed': isCollapsed },
    ]"
  >
    <div class="group-node-header nodrag">
      <button
        v-if="folderActions"
        class="collapse-toggle nodrag"
        :title="isCollapsed ? 'Expand folder' : 'Collapse folder'"
        @click.stop="toggleCollapse"
      >
        <span class="collapse-icon">{{ isCollapsed ? '\u25B6' : '\u25BC' }}</span>
      </button>
      <div class="group-node-label" :title="displayLabel">{{ displayLabel }}</div>
    </div>
    <template v-if="isCollapsed">
      <Handle type="target" :position="Position.Left" />
      <Handle type="source" :position="Position.Right" />
      <Handle type="target" :position="Position.Top" />
      <Handle type="source" :position="Position.Bottom" />
    </template>
  </div>
</template>

<style scoped>
.group-node-container {
  width: 100%;
  height: 100%;
  min-width: 220px;
  min-height: 80px;
  border: 2px dashed rgba(148, 163, 184, 0.8);
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.25);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.25);
  overflow: visible;
  padding: 28px 10px 10px 10px;
}

.group-node-collapsed {
  min-width: 180px;
  min-height: 48px;
  border: 2px solid rgba(96, 165, 250, 0.7);
  background: rgba(30, 41, 59, 0.5);
  box-shadow:
    inset 0 0 0 1px rgba(96, 165, 250, 0.2),
    0 0 8px rgba(96, 165, 250, 0.15);
  padding: 8px 10px;
}

.group-node-selected {
  border-color: rgba(96, 165, 250, 0.9);
  box-shadow:
    inset 0 0 0 1px rgba(96, 165, 250, 0.45),
    0 0 0 2px rgba(96, 165, 250, 0.2);
}

.group-node-header {
  display: flex;
  align-items: center;
  gap: 4px;
  position: absolute;
  top: 6px;
  left: 6px;
  right: 10px;
}

.group-node-collapsed .group-node-header {
  position: relative;
  top: auto;
  left: auto;
  right: auto;
}

.collapse-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: none;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.15);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 9px;
  line-height: 1;
  padding: 0;
  transition: background 120ms ease;
}

.collapse-toggle:hover {
  background: rgba(148, 163, 184, 0.3);
}

.collapse-icon {
  display: block;
}

.group-node-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
