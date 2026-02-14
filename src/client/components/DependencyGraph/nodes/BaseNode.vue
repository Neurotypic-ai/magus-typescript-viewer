<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { NodeToolbar } from '@vue-flow/node-toolbar';
import { computed, inject, toRef } from 'vue';

import { HIGHLIGHT_ORPHAN_GLOBAL_KEY, NODE_ACTIONS_KEY } from './utils';

import type { DependencyProps } from '../types';
import type { NodeActions } from './utils';

interface BaseNodeProps extends DependencyProps {
  minWidth?: string;
  zIndex?: number;
  badgeText: string;
  badgeClass?: string;
  isContainer?: boolean;
  showSubnodes?: boolean;
  subnodesCount?: number;
}

const props = withDefaults(defineProps<BaseNodeProps>(), {
  minWidth: '280px',
  zIndex: 1,
});

const nodeActions = inject<NodeActions | undefined>(NODE_ACTIONS_KEY, undefined);
const highlightOrphanGlobal = inject(HIGHLIGHT_ORPHAN_GLOBAL_KEY, undefined);

const nodeData = toRef(props, 'data');
const isSelected = computed(() => !!props.selected);

const isOrphanGlobal = computed(() => {
  if (!highlightOrphanGlobal?.value) {
    return false;
  }
  const diag = nodeData.value?.diagnostics as { orphanGlobal?: boolean } | undefined;
  return diag?.orphanGlobal === true;
});

const sourcePosition = computed(() => props.sourcePosition ?? Position.Bottom);
const targetPosition = computed(() => props.targetPosition ?? Position.Top);

const inferredContainer = computed(() => {
  if (typeof props.isContainer === 'boolean') {
    return props.isContainer;
  }

  if (props.type === 'module' || props.type === 'package' || props.type === 'group') {
    return true;
  }

  return Boolean(nodeData.value?.isContainer);
});

const resolvedSubnodesCount = computed(() => {
  if (typeof props.subnodesCount === 'number') {
    return props.subnodesCount;
  }

  const subnodes = nodeData.value?.subnodes as { count?: number } | undefined;
  return typeof subnodes?.count === 'number' ? subnodes.count : 0;
});

const resolvedSubnodesTotalCount = computed(() => {
  const subnodes = nodeData.value?.subnodes as { totalCount?: number; count?: number } | undefined;
  if (typeof subnodes?.totalCount === 'number') {
    return subnodes.totalCount;
  }
  return resolvedSubnodesCount.value;
});

const resolvedSubnodesHiddenCount = computed(() => {
  const subnodes = nodeData.value?.subnodes as { hiddenCount?: number } | undefined;
  if (typeof subnodes?.hiddenCount === 'number') {
    return Math.max(0, subnodes.hiddenCount);
  }
  return Math.max(0, resolvedSubnodesTotalCount.value - resolvedSubnodesCount.value);
});

const shouldShowSubnodes = computed(() => {
  if (typeof props.showSubnodes === 'boolean') {
    return props.showSubnodes;
  }

  return inferredContainer.value && (resolvedSubnodesTotalCount.value > 0 || resolvedSubnodesHiddenCount.value > 0);
});

const containerClasses = computed(() => ({
  'base-node-container': true,
  'base-node-selected': isSelected.value,
  'base-node-elevated': isSelected.value,
  'base-node-container--container': inferredContainer.value,
  'base-node-orphan-global': isOrphanGlobal.value,
  'base-node-no-hover': props.type === 'package',
}));

const containerStyle = computed(() => {
  if (inferredContainer.value) {
    return {
      width: '100%',
      height: '100%',
      minWidth: '100%',
      minHeight: '100%',
      zIndex: props.zIndex,
    };
  }

  return {
    minWidth: props.minWidth,
    zIndex: props.zIndex,
  };
});
</script>

<template>
  <div :class="containerClasses" :style="containerStyle">
    <NodeToolbar v-if="isSelected" :is-visible="true" :position="Position.Right" align="start" :offset="8">
      <div :class="['node-toolbar-actions', { 'node-toolbar-visible': isSelected }]">
        <button
          type="button"
          class="node-toolbar-button nodrag"
          aria-label="Focus camera on node"
          title="Focus node"
          @click.stop="nodeActions?.focusNode(props.id)"
        >
          <span class="node-toolbar-icon">◉</span> Focus
        </button>
        <button
          type="button"
          class="node-toolbar-button nodrag"
          aria-label="Isolate node and neighbors"
          title="Isolate neighborhood"
          @click.stop="nodeActions?.isolateNeighborhood(props.id)"
        >
          <span class="node-toolbar-icon">⊚</span> Isolate
        </button>
      </div>
    </NodeToolbar>

    <Handle type="target" :position="targetPosition" :key="`target-${targetPosition}`" class="base-node-handle" />

    <div class="base-node-header">
      <div class="base-node-title-container">
        <div class="base-node-title" :title="nodeData.label">
          {{ nodeData.label || 'Unnamed' }}
        </div>
      </div>
      <div :class="['base-node-badge', badgeClass]">
        {{ badgeText }}
      </div>
    </div>

    <section class="base-node-body">
      <slot name="body" />
    </section>

    <section v-if="shouldShowSubnodes" class="base-node-subnodes">
      <div class="base-node-subnodes-header">
        <span>Subnodes</span>
        <span class="base-node-subnodes-count">{{ resolvedSubnodesTotalCount }}</span>
      </div>
      <div class="base-node-subnodes-content">
        <slot name="subnodes">
          <div class="base-node-subnodes-empty">No subnodes</div>
        </slot>
      </div>
    </section>

    <slot name="empty" />

    <Handle type="source" :position="sourcePosition" :key="`source-${sourcePosition}`" class="base-node-handle" />
  </div>
</template>

<style scoped>
.base-node-container {
  position: relative;
  border-radius: 0.5rem;
  border: 1px solid var(--border-default);
  background-color: var(--background-node);
  contain: layout style;
  transition:
    transform 180ms ease-out,
    border-color 180ms ease-out,
    opacity 180ms ease-out;
  cursor: grab;
  font-size: 0.75rem;
  line-height: 1rem;
  display: flex;
  flex-direction: column;
}

.base-node-container--container {
  contain: layout style; /* no paint containment since overflow is visible */
  border-radius: 0.625rem;
  overflow: visible;
}

.base-node-container:hover {
  border-color: var(--border-hover);
}

.base-node-container.base-node-no-hover:not(.base-node-selected):hover {
  border-color: var(--border-default);
}

.base-node-container.base-node-elevated {
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.22);
  border-color: var(--border-hover);
}

.base-node-container.base-node-selected {
  border-color: var(--border-focus);
  outline: 1px solid rgba(144, 202, 249, 0.45);
  outline-offset: 0;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.16);
}

.base-node-container.base-node-orphan-global {
  outline: 2px solid #ef4444;
  outline-offset: 0;
  box-shadow: 0 1px 4px rgba(239, 68, 68, 0.24);
}

.base-node-handle {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

.base-node-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-bottom: 1px solid var(--border-default);
  padding: 0.45rem 0.5rem;
  min-height: 42px;
}

.base-node-title-container {
  flex: 1;
  min-width: 0;
}

.base-node-title {
  font-weight: 600;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.base-node-badge {
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  flex-shrink: 0;
}

/* Badge color variants — defined here because the badge element lives in BaseNode's template */
.base-node-badge.type-module {
  background-color: rgba(20, 184, 166, 0.2);
  color: rgb(94, 234, 212);
}

.base-node-badge.type-class {
  background-color: rgba(59, 130, 246, 0.2);
  color: rgb(147, 197, 253);
}

.base-node-badge.type-interface {
  background-color: rgba(168, 85, 247, 0.2);
  color: rgb(216, 180, 254);
}

.base-node-badge.type-property {
  background-color: rgba(20, 184, 166, 0.2);
  color: rgb(94, 234, 212);
}

.base-node-badge.type-method {
  background-color: rgba(249, 115, 22, 0.2);
  color: rgb(253, 186, 116);
}

.base-node-badge.type-default {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

.base-node-badge.package-badge {
  background-color: var(--background-node-package);
}

.base-node-body {
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid rgba(var(--border-default-rgb), 0.35);
}

.base-node-subnodes {
  display: flex;
  flex-direction: column;
  min-height: 44px;
}

.base-node-subnodes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.5rem;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
}

.base-node-subnodes-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.7rem;
}

.base-node-subnodes-content {
  padding: 0 0.5rem 0.45rem 0.5rem;
}

.base-node-subnodes-empty {
  font-size: 0.7rem;
  color: var(--text-secondary);
  opacity: 0.75;
}
</style>
