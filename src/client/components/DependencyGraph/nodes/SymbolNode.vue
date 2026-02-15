<script setup lang="ts">
import { computed, ref, toRef } from 'vue';

import BaseNode from './BaseNode.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { useIsolateExpandState } from './useIsolateExpandState';
import { buildBaseNodeProps, formatMethod, formatProperty } from './utils';

import type { DependencyProps } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = toRef(props, 'data');
const nodeType = toRef(props, 'type');

const properties = computed(() => nodeData.value.properties ?? []);
const methods = computed(() => nodeData.value.methods ?? []);

const isMemberNode = computed(() => nodeType.value === 'property' || nodeType.value === 'method');

const memberPropertyCount = computed(() => properties.value.length);
const memberMethodCount = computed(() => methods.value.length);
const totalMemberCount = computed(() => memberPropertyCount.value + memberMethodCount.value);

const isCollapsible = computed(() => {
  // Top-level nodes (no parent) can't be collapsed
  if (!props.parentNodeId) return false;
  return nodeData.value.collapsible === true;
});
const isCollapsed = ref(false);
const toggleCollapsed = () => {
  if (isCollapsible.value) {
    isCollapsed.value = !isCollapsed.value;
  }
};

useIsolateExpandState(
  () => isCollapsed.value,
  (saved) => { isCollapsed.value = saved; },
  () => { isCollapsed.value = false; },
);

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

const formattedProperties = computed(() => properties.value.map(formatProperty));
const formattedMethods = computed(() => methods.value.map(formatMethod));
</script>

<template>
  <BaseNode
    v-bind="baseNodeProps"
    :badge-text="badgeText"
    :badge-class="badgeClass"
    min-width="230px"
  >
    <template #body>
      <!-- Collapse toggle for collapsible symbol nodes -->
      <button
        v-if="isCollapsible"
        class="symbol-collapse-toggle nodrag"
        type="button"
        @click.stop="toggleCollapsed"
      >
        <span>{{ isCollapsed ? 'Show members' : 'Hide members' }} ({{ totalMemberCount }})</span>
        <span>{{ isCollapsed ? '+' : '\u2212' }}</span>
      </button>

      <div v-if="!isCollapsed" class="symbol-body-content">
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
                v-for="prop in formattedProperties.slice(0, 8)"
                :key="`prop-${prop.key}`"
                class="member-item"
              >
                <span class="member-visibility">{{ prop.indicator }}</span>
                <span class="member-name">{{ prop.name }}</span>
                <span class="member-type-annotation">: {{ prop.typeAnnotation }}</span>
              </div>
              <div v-if="formattedProperties.length > 8" class="member-overflow">
                +{{ formattedProperties.length - 8 }} more properties
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              v-if="memberMethodCount > 0"
              title="Methods"
              :count="memberMethodCount"
              :default-open="showMethods"
            >
              <div
                v-for="method in formattedMethods.slice(0, 8)"
                :key="`method-${method.key}`"
                class="member-item"
              >
                <span class="member-visibility">{{ method.indicator }}</span>
                <span class="member-name">{{ method.name }}()</span>
                <span class="member-type-annotation">: {{ method.typeAnnotation }}</span>
              </div>
              <div v-if="formattedMethods.length > 8" class="member-overflow">
                +{{ formattedMethods.length - 8 }} more methods
              </div>
            </CollapsibleSection>
          </div>

          <div v-else class="symbol-empty-state">No members</div>
        </div>
    </template>
  </BaseNode>
</template>

<style scoped>
.symbol-collapse-toggle {
  width: 100%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.55rem;
  cursor: pointer;
  margin-bottom: 0.35rem;
}

.symbol-collapse-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}

.symbol-body-content {
  display: flex;
  flex-direction: column;
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
  white-space: nowrap;
}

.member-type-annotation {
  color: var(--text-secondary);
  opacity: 0.8;
  white-space: nowrap;
}

.member-overflow {
  color: var(--text-secondary);
  font-size: 0.65rem;
  opacity: 0.7;
  padding: 0.15rem 0.35rem;
}
</style>
