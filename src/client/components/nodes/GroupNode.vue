<script setup lang="ts">
import { computed, inject } from 'vue';

import { Handle, Position } from '@vue-flow/core';

import { FOLDER_COLLAPSE_ACTIONS_KEY } from './utils';

import type { DependencyProps } from '../../types/DependencyProps';

const props = defineProps<DependencyProps>();
const folderActions = inject(FOLDER_COLLAPSE_ACTIONS_KEY, undefined);

const label = computed(() => props.data.label || 'Folder');
const isCollapsed = computed(() => props.data['isCollapsed'] === true);
const childCount = computed(() => (props.data['childCount'] as number | undefined) ?? 0);

function toggleCollapse() {
  folderActions?.toggleFolderCollapsed(props.id);
}

type HandleType = 'source' | 'target';

interface FolderHandleConfig {
  id: string;
  type: HandleType;
  position: Position;
  style: Record<string, string>;
  class: string;
}

const folderHandles: FolderHandleConfig[] = [
  {
    id: 'folder-left-in',
    type: 'target' as HandleType,
    position: Position.Left,
    style: { top: '50%' },
    class: 'folder-handle',
  },
  {
    id: 'folder-right-out',
    type: 'source' as HandleType,
    position: Position.Right,
    style: { top: '50%' },
    class: 'folder-handle',
  },
];
</script>

<template>
  <div
    :class="[
      'group-node-container',
      { 'group-node-selected': props.selected === true, 'group-node-collapsed': isCollapsed },
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
      <div class="group-node-label" :title="label">{{ label }}</div>
      <span v-if="isCollapsed && childCount > 0" class="folder-badge">{{ childCount }}</span>
    </div>
    <Handle
      v-for="h in isCollapsed ? folderHandles : []"
      :id="h.id"
      :key="h.id"
      :type="h.type"
      :position="h.position"
      :style="h.style"
      :class="h.class"
      :tabindex="-1"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.group-node-container {
  width: 100%;
  height: 100%;
  min-width: 220px;
  min-height: 80px;
  border: 2px dashed var(--graph-folder-border);
  border-radius: 10px;
  background: var(--graph-folder-bg);
  box-shadow: inset 0 0 0 1px var(--graph-folder-border-muted);
  overflow: visible;
  padding: 8px 8px 8px 8px;
  transition:
    border-color 120ms linear,
    background-color 120ms linear,
    box-shadow 120ms linear;
}

.group-node-collapsed {
  min-width: 180px;
  min-height: 48px;
  border: 3px solid var(--graph-folder-active-border);
  background: var(--graph-folder-collapsed-bg);
  box-shadow:
    inset 0 0 0 1px var(--graph-folder-badge-bg),
    0 0 12px var(--graph-folder-active-shadow),
    0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 8px 10px;
}

/* Accessibility: respect reduced-motion preferences (WCAG 2.1 SC 2.3.3) */
@media (prefers-reduced-motion: reduce) {
  .group-node-container {
    transition: none;
  }
}

.group-node-selected {
  border-color: var(--graph-folder-active-border-strong);
  box-shadow:
    inset 0 0 0 1px var(--graph-folder-active-outline),
    0 0 0 2px var(--graph-folder-active-shadow);
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
  background: rgba(var(--text-secondary-rgb), 0.15);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 9px;
  line-height: 1;
  padding: 0;
  transition: background 120ms ease;
}

.collapse-toggle:hover {
  background: rgba(var(--text-secondary-rgb), 0.3);
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

.folder-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--graph-folder-badge-bg);
  color: var(--graph-folder-badge-text);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.folder-handle {
  width: 4px !important;
  height: 4px !important;
  opacity: 0.15;
  border: none;
  background: var(--graph-folder-handle-bg);
  box-shadow: none;
  transition:
    opacity 120ms ease,
    box-shadow 120ms ease;
}

.group-node-container:hover .folder-handle {
  opacity: 0.42;
  box-shadow: 0 0 4px var(--graph-folder-handle-shadow);
}

</style>
