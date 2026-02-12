<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';

import { useGraphSettings } from '../../../stores/graphSettings';

import type { DependencyProps } from '../types';

interface BaseNodeProps extends DependencyProps {
  minWidth?: string;
  maxWidth?: string;
  zIndex?: number;
  badgeText: string;
  badgeClass?: string;
  isContainer?: boolean;
  showSubnodes?: boolean;
  subnodesCount?: number;
}

const props = withDefaults(defineProps<BaseNodeProps>(), {
  minWidth: '280px',
  maxWidth: '420px',
  zIndex: 1,
});

const graphSettings = useGraphSettings();

const nodeData = computed(() => props.data);
const isSelected = computed(() => !!props.selected);

const isOrphanGlobal = computed(() => {
  if (!graphSettings.highlightOrphanGlobal) {
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
    maxWidth: props.maxWidth,
    zIndex: props.zIndex,
  };
});

const triggerNodeAction = (action: 'focus' | 'isolate') => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('dependency-graph-node-action', {
      detail: {
        action,
        nodeId: props.id,
      },
    })
  );
};
</script>

<template>
  <div
    :class="[
      'base-node-container',
      {
        'base-node-selected': isSelected,
        'base-node-container--container': inferredContainer,
        'base-node-orphan-global': isOrphanGlobal,
      },
    ]"
    :style="containerStyle"
  >
    <Handle type="target" :position="targetPosition" :key="`target-${targetPosition}`" class="base-node-handle" />

    <div class="base-node-header">
      <div class="base-node-title-container">
        <div class="base-node-title" :title="nodeData.label">
          {{ nodeData.label || 'Unnamed' }}
        </div>
      </div>
      <div class="base-node-actions">
        <button
          type="button"
          class="base-node-action-button"
          aria-label="Focus camera on node"
          title="Focus node"
          @click.stop="triggerNodeAction('focus')"
        >
          ◉
        </button>
        <button
          type="button"
          class="base-node-action-button"
          aria-label="Isolate node and neighbors"
          title="Isolate neighborhood"
          @click.stop="triggerNodeAction('isolate')"
        >
          ⊚
        </button>
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
  transition:
    transform 180ms ease-out,
    box-shadow 180ms ease-out,
    border-color 180ms ease-out,
    opacity 180ms ease-out;
  cursor: move;
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05);
  font-size: 0.75rem;
  line-height: 1rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.base-node-container--container {
  border-radius: 0.625rem;
  overflow: visible;
}

.base-node-container:hover {
  border-color: var(--border-hover);
}

.base-node-container.base-node-selected {
  border-color: var(--border-focus);
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05),
    0 0 12px rgba(144, 202, 249, 0.4);
}

.base-node-container.base-node-orphan-global {
  outline: 2px solid #ef4444;
  outline-offset: -1px;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.45);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.base-node-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.base-node-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  border: 1px solid rgba(var(--border-default-rgb), 0.6);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: 0.68rem;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 140ms ease-out,
    color 140ms ease-out,
    border-color 140ms ease-out;
}

.base-node-action-button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
  border-color: var(--border-hover);
}
</style>
