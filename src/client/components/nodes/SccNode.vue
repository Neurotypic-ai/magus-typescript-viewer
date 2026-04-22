<script setup lang="ts">
import { computed } from 'vue';

import { Handle, Position } from '@vue-flow/core';

import type { DependencyProps } from '../../types/DependencyProps';

const props = defineProps<DependencyProps>();

const memberCount = computed<number>(() => {
  const members = props.data['sccMembers'];
  return Array.isArray(members) ? members.length : 0;
});
const label = computed(() => `SCC (${String(memberCount.value)} members)`);

type HandleType = 'source' | 'target';

interface SccHandleConfig {
  id: string;
  type: HandleType;
  position: Position;
  style: Record<string, string>;
  class: string;
}

const sccHandles: SccHandleConfig[] = [
  {
    id: 'scc-left-in',
    type: 'target' as HandleType,
    position: Position.Left,
    style: { top: '50%' },
    class: 'scc-handle',
  },
  {
    id: 'scc-right-out',
    type: 'source' as HandleType,
    position: Position.Right,
    style: { top: '50%' },
    class: 'scc-handle',
  },
];
</script>

<template>
  <div :class="['scc-node-container', { 'scc-node-selected': props.selected === true }]">
    <div class="scc-node-header nodrag">
      <div class="scc-node-label" :title="label">{{ label }}</div>
      <span class="scc-badge">{{ memberCount }}</span>
    </div>
    <Handle
      v-for="h in sccHandles"
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
.scc-node-container {
  width: 100%;
  height: 100%;
  min-width: 220px;
  min-height: 120px;
  border: 2px dashed rgba(244, 63, 94, 0.7);
  border-radius: 12px;
  background: rgba(244, 63, 94, 0.06);
  box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.4);
  overflow: visible;
  padding: 8px;
  transition:
    border-color 120ms linear,
    background-color 120ms linear,
    box-shadow 120ms linear;
}

/* Accessibility: respect reduced-motion preferences (WCAG 2.1 SC 2.3.3) */
@media (prefers-reduced-motion: reduce) {
  .scc-node-container {
    transition: none;
  }
}

.scc-node-selected {
  border-color: rgba(244, 63, 94, 0.95);
  box-shadow:
    inset 0 0 0 1px rgba(244, 63, 94, 0.55),
    0 0 0 2px rgba(244, 63, 94, 0.35);
}

.scc-node-header {
  display: flex;
  align-items: center;
  gap: 6px;
  position: absolute;
  top: 6px;
  left: 8px;
  right: 8px;
}

.scc-node-label {
  font-size: 11px;
  font-weight: 700;
  color: rgb(254, 205, 211);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.scc-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(244, 63, 94, 0.35);
  color: rgb(254, 205, 211);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.scc-handle {
  width: 4px !important;
  height: 4px !important;
  opacity: 0.3;
  border: none;
  background: rgba(244, 63, 94, 0.8);
  box-shadow: none;
  transition:
    opacity 120ms ease,
    box-shadow 120ms ease;
}

.scc-node-container:hover .scc-handle {
  opacity: 0.7;
  box-shadow: 0 0 4px rgba(244, 63, 94, 0.7);
}
</style>
