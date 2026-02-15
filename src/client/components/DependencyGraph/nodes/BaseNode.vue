<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { NodeToolbar } from '@vue-flow/node-toolbar';
import { computed, inject, toRef } from 'vue';

import { useInsightsStore } from '../../../stores/insightsStore';
import { useIssuesStore } from '../../../stores/issuesStore';
import InsightBadgeStrip from './InsightBadgeStrip.vue';
import { HIGHLIGHT_ORPHAN_GLOBAL_KEY, NODE_ACTIONS_KEY, resolveSubnodesCount } from './utils';

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

const issuesStore = useIssuesStore();
const insightsStore = useInsightsStore();

const nodeData = toRef(props, 'data');
const isSelected = computed(() => !!props.selected);

const issueCount = computed(() => issuesStore.issueCountByNodeId.get(props.id) ?? 0);

const maxIssueSeverity = computed(() => {
  const nodeIssues = issuesStore.issues.filter(
    (i) => i.module_id === props.id || i.entity_id === props.id || i.parent_entity_id === props.id
  );
  if (nodeIssues.some((i) => i.severity === 'error')) return 'error';
  if (nodeIssues.some((i) => i.severity === 'warning')) return 'warning';
  if (nodeIssues.length > 0) return 'info';
  return null;
});

function handleIssueBadgeClick(): void {
  issuesStore.setNodeFilter(props.id);
}

function handleContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  nodeActions?.showContextMenu(props.id, nodeData.value?.label ?? props.id, event);
}

const isOrphanGlobal = computed(() => {
  if (!highlightOrphanGlobal?.value) {
    return false;
  }
  const diag = nodeData.value?.diagnostics as { orphanGlobal?: boolean } | undefined;
  return diag?.orphanGlobal === true;
});

const insightCounts = computed(() => insightsStore.nodeSeverityCounts(props.id));
const hasInsights = computed(() => insightCounts.value.critical > 0 || insightCounts.value.warning > 0 || insightCounts.value.info > 0);
const insightGlowClass = computed(() => {
  if (insightCounts.value.critical > 0) return 'base-node-insight-critical';
  if (insightCounts.value.warning > 0) return 'base-node-insight-warning';
  return null;
});
const isInsightDimmed = computed(() => {
  if (!insightsStore.activeFilter) return false;
  return !insightsStore.filteredNodeIds.has(props.id);
});

const sourcePosition = computed(() => props.sourcePosition ?? Position.Bottom);
const targetPosition = computed(() => props.targetPosition ?? Position.Top);

const handles = computed(() => [
  { id: 'relational-in', type: 'target' as const, position: targetPosition.value, class: 'base-node-handle' },
  { id: 'relational-in-top', type: 'target' as const, position: Position.Top, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-in-right', type: 'target' as const, position: Position.Right, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-in-bottom', type: 'target' as const, position: Position.Bottom, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-in-left', type: 'target' as const, position: Position.Left, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-out', type: 'source' as const, position: sourcePosition.value, class: 'base-node-handle' },
  { id: 'relational-out-top', type: 'source' as const, position: Position.Top, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-out-right', type: 'source' as const, position: Position.Right, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-out-bottom', type: 'source' as const, position: Position.Bottom, class: 'base-node-handle base-node-handle--aux' },
  { id: 'relational-out-left', type: 'source' as const, position: Position.Left, class: 'base-node-handle base-node-handle--aux' },
]);

const inferredContainer = computed(() => {
  if (typeof props.isContainer === 'boolean') {
    return props.isContainer;
  }

  if (props.type === 'module' || props.type === 'package' || props.type === 'group') {
    return true;
  }

  return Boolean(nodeData.value?.isContainer);
});

const subnodesResolved = computed(() => {
  if (typeof props.subnodesCount === 'number') {
    return { count: props.subnodesCount, totalCount: props.subnodesCount, hiddenCount: 0 };
  }
  return resolveSubnodesCount(nodeData.value?.subnodes as { count?: number; totalCount?: number; hiddenCount?: number } | undefined);
});

const shouldShowSubnodes = computed(() => {
  if (typeof props.showSubnodes === 'boolean') {
    return props.showSubnodes;
  }

  return inferredContainer.value && (subnodesResolved.value.totalCount > 0 || subnodesResolved.value.hiddenCount > 0);
});

const containerClasses = computed(() => ({
  'base-node-container': true,
  'base-node-selected': isSelected.value,
  'base-node-elevated': isSelected.value,
  'base-node-container--container': inferredContainer.value,
  'base-node-orphan-global': isOrphanGlobal.value,
  'base-node-no-hover': props.type === 'package',
  [insightGlowClass.value ?? '']: !!insightGlowClass.value,
  'base-node-insight-dimmed': isInsightDimmed.value,
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
  <div :class="containerClasses" :style="containerStyle" @contextmenu="handleContextMenu">
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

    <Handle
      v-for="h in handles.slice(0, 5)"
      :key="h.id"
      :id="h.id"
      :type="h.type"
      :position="h.position"
      :class="h.class"
    />

    <button
      v-if="issueCount > 0"
      type="button"
      :class="['issue-indicator', `issue-indicator--${maxIssueSeverity}`]"
      :title="`${issueCount} issue${issueCount > 1 ? 's' : ''}`"
      @click.stop="handleIssueBadgeClick"
    >
      {{ maxIssueSeverity === 'error' ? '!' : '\u26A0' }}
      <span v-if="issueCount > 1" class="issue-indicator-count">{{ issueCount }}</span>
    </button>

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

    <InsightBadgeStrip
      v-if="hasInsights"
      :critical="insightCounts.critical"
      :warning="insightCounts.warning"
      :info="insightCounts.info"
    />

    <section class="base-node-body">
      <slot name="body" />
    </section>

    <section v-if="shouldShowSubnodes" class="base-node-subnodes">
      <div class="base-node-subnodes-header">
        <span>Subnodes</span>
        <span class="base-node-subnodes-count">{{ subnodesResolved.totalCount }}</span>
      </div>
      <div class="base-node-subnodes-content">
        <slot name="subnodes">
          <div class="base-node-subnodes-empty">No subnodes</div>
        </slot>
      </div>
    </section>

    <slot name="empty" />

    <Handle
      v-for="h in handles.slice(5)"
      :key="h.id"
      :id="h.id"
      :type="h.type"
      :position="h.position"
      :class="h.class"
    />
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
    border-color 120ms linear,
    opacity 120ms linear;
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
  transition:
    border-color 120ms linear,
    opacity 120ms linear;
}

/* Accessibility: respect reduced-motion preferences (WCAG 2.1 SC 2.3.3) */
@media (prefers-reduced-motion: reduce) {
  .base-node-container,
  .base-node-container--container {
    transition: none;
  }
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

.base-node-handle--aux {
  width: 4px !important;
  height: 4px !important;
  opacity: 0;
  pointer-events: none;
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

.issue-indicator {
  position: absolute;
  top: -6px;
  right: -6px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.1rem 0.3rem;
  border-radius: 9999px;
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  border: 1px solid;
  min-width: 18px;
  min-height: 18px;
  justify-content: center;
  background-color: var(--background-node);
}

.issue-indicator--warning {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.5);
}

.issue-indicator--error {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.5);
}

.issue-indicator--info {
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.5);
}

.issue-indicator:hover {
  transform: scale(1.15);
}

.issue-indicator-count {
  font-size: 0.6rem;
}

/* Insight glow */
.base-node-insight-critical {
  box-shadow: 0 0 8px 1px rgba(239, 68, 68, 0.35);
}

.base-node-insight-warning {
  box-shadow: 0 0 8px 1px rgba(251, 191, 36, 0.28);
}

/* Insight filter dimming */
.base-node-insight-dimmed {
  opacity: 0.25;
}
</style>
