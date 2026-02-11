<script setup lang="ts">
import { computed } from 'vue';

import BaseNode from './BaseNode.vue';

import type { DependencyProps } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);
const nodeType = computed(() => props.type);

const properties = computed(() => nodeData.value.properties ?? []);
const methods = computed(() => nodeData.value.methods ?? []);

const isMemberNode = computed(() => nodeType.value === 'property' || nodeType.value === 'method');

const membersMeta = computed(
  () =>
    (nodeData.value.members as {
      totalCount?: number;
      byType?: Partial<Record<'property' | 'method', number>>;
      mode?: 'compact' | 'graph';
    } | undefined) ?? {}
);

const memberMode = computed<'compact' | 'graph'>(() => {
  const mode = membersMeta.value.mode;
  return mode === 'graph' ? 'graph' : 'compact';
});

const memberPropertyCount = computed(() => membersMeta.value.byType?.property ?? properties.value.length);
const memberMethodCount = computed(() => membersMeta.value.byType?.method ?? methods.value.length);
const totalMemberCount = computed(
  () => membersMeta.value.totalCount ?? memberPropertyCount.value + memberMethodCount.value
);

const inferredSubnodeCount = computed(() => {
  const explicitCount = (nodeData.value.subnodes as { count?: number } | undefined)?.count;
  if (typeof explicitCount === 'number') {
    return explicitCount;
  }
  return 0;
});

const baseNodeProps = computed(() => ({
  id: props.id,
  type: props.type,
  data: props.data,
  ...(props.selected !== undefined ? { selected: props.selected } : {}),
  ...(props.width !== undefined ? { width: props.width } : {}),
  ...(props.height !== undefined ? { height: props.height } : {}),
  ...(props.sourcePosition !== undefined ? { sourcePosition: props.sourcePosition } : {}),
  ...(props.targetPosition !== undefined ? { targetPosition: props.targetPosition } : {}),
  isContainer:
    !isMemberNode.value && memberMode.value === 'graph' && (nodeData.value.isContainer === true || inferredSubnodeCount.value > 0),
  showSubnodes: !isMemberNode.value && memberMode.value === 'graph' && inferredSubnodeCount.value > 0,
  subnodesCount: inferredSubnodeCount.value,
  zIndex: isMemberNode.value ? 3 : 2,
}));

const badgeClass = computed(() => {
  switch (nodeType.value) {
    case 'class':
      return 'type-class';
    case 'interface':
      return 'type-interface';
    case 'property':
      return 'type-property';
    case 'method':
      return 'type-method';
    default:
      return 'type-default';
  }
});

const badgeText = computed(() => String(nodeType.value ?? 'symbol').toUpperCase());
</script>

<template>
  <BaseNode
    v-bind="baseNodeProps"
    :badge-text="badgeText"
    :badge-class="badgeClass"
    min-width="230px"
    max-width="380px"
  >
    <template #body>
      <div v-if="isMemberNode" class="member-node-body">
        <span class="member-type">{{ nodeType }}</span>
      </div>

      <div v-else-if="totalMemberCount > 0" class="symbol-summary">
        <span class="summary-label">Members:</span>
        <span>{{ memberPropertyCount }} properties</span>
        <span>•</span>
        <span>{{ memberMethodCount }} methods</span>
      </div>

      <div v-else class="symbol-empty-state">No members</div>
    </template>

    <template #subnodes>
      <div v-if="memberMode === 'graph' && totalMemberCount > 0" class="member-graph-hint">
        Member nodes are rendered directly in the graph.
      </div>
    </template>
  </BaseNode>
</template>

<style scoped>
.type-class {
  background-color: rgba(59, 130, 246, 0.2);
  color: rgb(147, 197, 253);
}

.type-interface {
  background-color: rgba(168, 85, 247, 0.2);
  color: rgb(216, 180, 254);
}

.type-property {
  background-color: rgba(20, 184, 166, 0.2);
  color: rgb(94, 234, 212);
}

.type-method {
  background-color: rgba(249, 115, 22, 0.2);
  color: rgb(253, 186, 116);
}

.type-default {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

.member-node-body,
.symbol-summary,
.symbol-empty-state,
.member-graph-hint {
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.member-type {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}

.symbol-summary {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}

.summary-label {
  color: var(--text-primary);
  font-weight: 600;
}

.member-graph-hint {
  opacity: 0.8;
}
</style>
