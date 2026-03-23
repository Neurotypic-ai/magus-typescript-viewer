<script setup lang="ts">
import { computed } from 'vue';

import type { DependencyNode } from '../../../types/DependencyNode';

interface MeasureGroupNodeProps {
  node: DependencyNode;
}

const props = defineProps<MeasureGroupNodeProps>();

const label = computed(() => props.node.data?.label ?? 'Folder');
const isCollapsed = computed(() => props.node.data?.['isCollapsed'] === true);
const childCount = computed(() => (props.node.data?.['childCount'] as number | undefined) ?? 0);
</script>

<template>
  <div :class="['group-node-container', { 'group-node-collapsed': isCollapsed }]">
    <div class="group-node-header">
      <button class="collapse-toggle" :title="isCollapsed ? 'Expand folder' : 'Collapse folder'" type="button">
        <span class="collapse-icon">{{ isCollapsed ? '\u25B6' : '\u25BC' }}</span>
      </button>
      <div class="group-node-label" :title="label">{{ label }}</div>
      <span v-if="isCollapsed && childCount > 0" class="folder-badge">{{ childCount }}</span>
    </div>
  </div>
</template>

<style scoped>
.group-node-container {
  width: auto;
  min-width: 220px;
  min-height: 80px;
  border: 2px dashed var(--graph-folder-border);
  border-radius: 10px;
  background: var(--graph-folder-bg);
  box-shadow: inset 0 0 0 1px var(--graph-folder-border-muted);
  overflow: visible;
  padding: 8px;
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
}

.group-node-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 32px;
}

.collapse-toggle {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.collapse-icon {
  line-height: 1;
  font-size: 0.72rem;
}

.group-node-label {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-badge {
  padding: 0.12rem 0.32rem;
  border-radius: 9999px;
  background: var(--graph-folder-badge-bg);
  color: var(--graph-folder-badge-text);
  font-size: 0.62rem;
  font-weight: 700;
  flex-shrink: 0;
}
</style>
