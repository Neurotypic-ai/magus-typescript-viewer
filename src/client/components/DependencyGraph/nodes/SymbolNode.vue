<script setup lang="ts">
import { computed, ref } from 'vue';

import BaseNode from './BaseNode.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { buildBaseNodeProps } from './utils';

import type { DependencyProps, NodeMethod, NodeProperty } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);
const nodeType = computed(() => props.type);

const properties = computed(() => nodeData.value.properties ?? []);
const methods = computed(() => nodeData.value.methods ?? []);

const isMemberNode = computed(() => nodeType.value === 'property' || nodeType.value === 'method');

const memberPropertyCount = computed(() => properties.value.length);
const memberMethodCount = computed(() => methods.value.length);
const totalMemberCount = computed(() => memberPropertyCount.value + memberMethodCount.value);

const baseNodeProps = computed(() => buildBaseNodeProps(props, {
  zIndex: isMemberNode.value ? 4 : 3,
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

const showProperties = ref(true);
const showMethods = ref(true);

const visibilityIndicator = (visibility: string): string => {
  switch (visibility) {
    case 'public':
      return 'p';
    case 'protected':
      return '#';
    case 'private':
      return '-';
    default:
      return 'p';
  }
};

const formatProperty = (prop: NodeProperty): { indicator: string; name: string; type: string } => ({
  indicator: visibilityIndicator(prop.visibility),
  name: prop.name,
  type: prop.type || 'unknown',
});

const formatMethod = (method: NodeMethod): { indicator: string; name: string; returnType: string } => ({
  indicator: visibilityIndicator(method.visibility),
  name: method.name,
  returnType: method.returnType || 'void',
});
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

      <div v-else-if="totalMemberCount > 0" class="symbol-members">
        <CollapsibleSection
          v-if="memberPropertyCount > 0"
          title="Properties"
          :count="memberPropertyCount"
          :default-open="showProperties"
        >
          <div
            v-for="(prop, index) in properties"
            :key="`prop-${index}`"
            class="member-item"
          >
            <span class="member-visibility">{{ formatProperty(prop).indicator }}</span>
            <span class="member-name">{{ formatProperty(prop).name }}</span>
            <span class="member-type-annotation">: {{ formatProperty(prop).type }}</span>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          v-if="memberMethodCount > 0"
          title="Methods"
          :count="memberMethodCount"
          :default-open="showMethods"
        >
          <div
            v-for="(method, index) in methods"
            :key="`method-${index}`"
            class="member-item"
          >
            <span class="member-visibility">{{ formatMethod(method).indicator }}</span>
            <span class="member-name">{{ formatMethod(method).name }}()</span>
            <span class="member-type-annotation">: {{ formatMethod(method).returnType }}</span>
          </div>
        </CollapsibleSection>
      </div>

      <div v-else class="symbol-empty-state">No members</div>
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
.symbol-members,
.symbol-empty-state {
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.member-type {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}

.symbol-members {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.member-item {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.68rem;
  line-height: 1.3;
}

.member-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.member-visibility {
  color: var(--text-secondary);
  opacity: 0.7;
  font-size: 0.62rem;
  min-width: 0.7rem;
  flex-shrink: 0;
}

.member-name {
  color: var(--text-primary);
  font-weight: 700;
  word-break: break-word;
}

.member-type-annotation {
  color: var(--text-secondary);
  opacity: 0.8;
  word-break: break-word;
}
</style>
