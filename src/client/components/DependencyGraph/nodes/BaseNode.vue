<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';

import type { DependencyProps } from '../types';

interface BaseNodeProps extends DependencyProps {
  minWidth?: string;
  maxWidth?: string;
  zIndex?: number;
  badgeText: string;
  badgeClass?: string;
}

const props = withDefaults(defineProps<BaseNodeProps>(), {
  minWidth: '280px',
  maxWidth: '400px',
  zIndex: 1,
});

const nodeData = computed(() => props.data);
const isSelected = computed(() => !!props.selected);

// Get handle positions from props (set by createGraphNodes based on layout direction)
// These are set dynamically by Vue Flow based on layout direction
const sourcePosition = computed(() => props.sourcePosition ?? Position.Bottom);
const targetPosition = computed(() => props.targetPosition ?? Position.Top);

// Container style
const containerStyle = computed(() => ({
  minWidth: props.minWidth,
  maxWidth: props.maxWidth,
  zIndex: props.zIndex,
}));
</script>

<template>
  <div :class="['base-node-container', { 'base-node-selected': isSelected }]" :style="containerStyle">
    <Handle type="target" :position="targetPosition" :key="`target-${targetPosition}`" class="base-node-handle" />

    <!-- Node Header -->
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

    <!-- Node Content Slot -->
    <slot name="content" />

    <!-- Empty State Slot -->
    <slot name="empty" />

    <Handle type="source" :position="sourcePosition" :key="`source-${sourcePosition}`" class="base-node-handle" />
  </div>
</template>

<style scoped>
/* Base Node Container */
.base-node-container {
  position: relative;
  border-radius: 0.5rem;
  border: 1px solid var(--border-default);
  background-color: var(--background-node);
  transition: all 200ms;
  cursor: move;
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05);
  font-size: 0.75rem;
  line-height: 1rem;
  padding: 0;
  overflow: hidden;
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

/* Node Handles */
.base-node-handle {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

/* Node Header */
.base-node-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-bottom: 1px solid var(--border-default);
  padding: 0.5rem 0.75rem;
}

.base-node-title-container {
  flex: 1;
  min-width: 0;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
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
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  flex-shrink: 0;
}

/* Shared Animations */
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slide-in-from-top {
  from {
    transform: translateY(-8px);
  }
  to {
    transform: translateY(0);
  }
}
</style>
