<script setup lang="ts">
import { computed, ref } from 'vue';

import BaseNode from './BaseNode.vue';

import type { DependencyProps } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);
const nodeType = computed(() => props.type);

const properties = computed(() => nodeData.value.properties ?? []);
const methods = computed(() => nodeData.value.methods ?? []);

const isMemberNode = computed(() => nodeType.value === 'property' || nodeType.value === 'method');

const inferredSubnodeCount = computed(() => {
  const explicitCount = (nodeData.value.subnodes as { count?: number } | undefined)?.count;
  if (typeof explicitCount === 'number') {
    return explicitCount;
  }
  return properties.value.length + methods.value.length;
});

const hasMembers = computed(() => properties.value.length > 0 || methods.value.length > 0);

const baseNodeProps = computed(() => ({
  id: props.id,
  type: props.type,
  data: props.data,
  ...(props.selected !== undefined ? { selected: props.selected } : {}),
  ...(props.width !== undefined ? { width: props.width } : {}),
  ...(props.height !== undefined ? { height: props.height } : {}),
  ...(props.sourcePosition !== undefined ? { sourcePosition: props.sourcePosition } : {}),
  ...(props.targetPosition !== undefined ? { targetPosition: props.targetPosition } : {}),
  isContainer: !isMemberNode.value && (nodeData.value.isContainer === true || inferredSubnodeCount.value > 0),
  showSubnodes: !isMemberNode.value && inferredSubnodeCount.value > 0,
  subnodesCount: inferredSubnodeCount.value,
  zIndex: 2,
}));

const showProperties = ref(true);
const showMethods = ref(true);

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

function visibilityToken(visibility: string | undefined): string {
  if (visibility === 'public') return '+';
  if (visibility === 'protected') return '#';
  return '-';
}
</script>

<template>
  <BaseNode
    v-bind="baseNodeProps"
    :badge-text="badgeText"
    :badge-class="badgeClass"
    min-width="240px"
    max-width="420px"
  >
    <template #body>
      <div v-if="isMemberNode" class="member-node-body">
        <span v-if="nodeType === 'property'" class="member-type">property</span>
        <span v-else-if="nodeType === 'method'" class="member-type">method</span>
      </div>

      <div v-else-if="hasMembers" class="symbol-summary">
        <span>{{ properties.length }} properties</span>
        <span>•</span>
        <span>{{ methods.length }} methods</span>
      </div>

      <div v-else class="symbol-empty-state">No members</div>
    </template>

    <template #subnodes>
      <div v-if="properties.length > 0" class="member-section">
        <button class="member-section-toggle" type="button" @click="showProperties = !showProperties">
          <span>Properties ({{ properties.length }})</span>
          <span>{{ showProperties ? '−' : '+' }}</span>
        </button>
        <div v-if="showProperties" class="member-list">
          <div v-for="(prop, index) in properties" :key="prop.id ?? `prop-${index}`" class="member-item">
            <span class="member-visibility">{{ visibilityToken(prop.visibility) }}</span>
            <span class="member-name">{{ prop.name }}</span>
            <span class="member-type-hint">: {{ prop.type }}</span>
          </div>
        </div>
      </div>

      <div v-if="methods.length > 0" class="member-section">
        <button class="member-section-toggle" type="button" @click="showMethods = !showMethods">
          <span>Methods ({{ methods.length }})</span>
          <span>{{ showMethods ? '−' : '+' }}</span>
        </button>
        <div v-if="showMethods" class="member-list">
          <div v-for="(method, index) in methods" :key="method.id ?? `method-${index}`" class="member-item">
            <span class="member-visibility">{{ visibilityToken(method.visibility) }}</span>
            <span class="member-name">{{ method.name }}()</span>
            <span class="member-type-hint">: {{ method.returnType }}</span>
          </div>
        </div>
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
.symbol-empty-state {
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
  gap: 0.35rem;
  align-items: center;
}

.member-section + .member-section {
  margin-top: 0.35rem;
}

.member-section-toggle {
  width: 100%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 0.3rem;
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.3rem 0.45rem;
  cursor: pointer;
}

.member-list {
  margin-top: 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.member-item {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.72rem;
}

.member-visibility {
  width: 0.7rem;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.member-name {
  color: var(--text-primary);
  font-weight: 600;
}

.member-type-hint {
  color: var(--text-secondary);
  word-break: break-word;
}
</style>
