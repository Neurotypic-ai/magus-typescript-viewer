<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import { useIssuesStore } from '../stores/issuesStore';

import type { CodeIssueRef } from '../types';

interface NodeContextMenuProps {
  nodeId: string;
  nodeLabel: string;
  x: number;
  y: number;
}

const props = defineProps<NodeContextMenuProps>();

const emit = defineEmits<{
  close: [];
  focusNode: [id: string];
  isolateNeighborhood: [id: string];
}>();

const issuesStore = useIssuesStore();

const nodeIssues = computed(() => {
  return issuesStore.issues.filter(
    (issue) =>
      issue.module_id === props.nodeId ||
      issue.entity_id === props.nodeId ||
      issue.parent_entity_id === props.nodeId
  );
});

const refactorableIssues = computed(() => {
  return nodeIssues.value.filter((issue) => issue.refactor_action);
});

function handleFocusNode(): void {
  emit('focusNode', props.nodeId);
  emit('close');
}

function handleIsolateNeighborhood(): void {
  emit('isolateNeighborhood', props.nodeId);
  emit('close');
}

function handleViewIssues(): void {
  issuesStore.setNodeFilter(props.nodeId);
  emit('close');
}

async function handlePreview(issue: CodeIssueRef): Promise<void> {
  await issuesStore.previewRefactor(issue.id);
  issuesStore.setNodeFilter(props.nodeId);
  emit('close');
}

function handleClickOutside(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (!target.closest('.node-context-menu')) {
    emit('close');
  }
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside, true);
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside, true);
  document.removeEventListener('keydown', handleEscape);
});
</script>

<template>
  <div class="node-context-menu" :style="{ left: `${x}px`, top: `${y}px` }">
    <div class="context-menu-header">{{ nodeLabel }}</div>
    <button type="button" class="context-menu-item" @click="handleFocusNode">
      <span class="context-menu-icon">&loz;</span> Focus Node
    </button>
    <button type="button" class="context-menu-item" @click="handleIsolateNeighborhood">
      <span class="context-menu-icon">&cir;</span> Isolate Neighborhood
    </button>
    <template v-if="nodeIssues.length > 0">
      <button type="button" class="context-menu-item" @click="handleViewIssues">
        <span class="context-menu-icon">&starf;</span> View Issues ({{ nodeIssues.length }})
      </button>
    </template>
    <template v-if="refactorableIssues.length > 0">
      <div class="context-menu-separator" />
      <button
        v-for="issue in refactorableIssues"
        :key="issue.id"
        type="button"
        class="context-menu-item context-menu-item--refactor"
        @click="handlePreview(issue)"
      >
        <span class="context-menu-icon">&wrench;</span>
        {{ issue.suggestion ?? 'Preview refactoring' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.node-context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  max-width: 340px;
  background-color: var(--background-node);
  border: 1px solid var(--border-default);
  border-radius: 0.375rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  padding: 0.25rem 0;
  font-size: 0.8rem;
}

.context-menu-header {
  padding: 0.35rem 0.75rem;
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.4rem 0.75rem;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.8rem;
  text-align: left;
  white-space: nowrap;
}

.context-menu-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.context-menu-item--refactor {
  color: rgb(94, 234, 212);
  white-space: normal;
  font-size: 0.75rem;
}

.context-menu-icon {
  flex-shrink: 0;
  width: 1rem;
  text-align: center;
}

.context-menu-separator {
  height: 1px;
  background-color: rgba(255, 255, 255, 0.06);
  margin: 0.25rem 0;
}
</style>
