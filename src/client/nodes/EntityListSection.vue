<script setup lang="ts">
import { computed, inject, ref } from 'vue';

import CollapsibleSection from './CollapsibleSection.vue';
import { ISOLATE_EXPAND_ALL_KEY } from './utils';

import type { EmbeddedModuleEntity } from '../types';

interface EntityListSectionProps {
  title: string;
  entities: EmbeddedModuleEntity[];
  badgeText: string;
  badgeClass: string;
  defaultOpen?: boolean;
  maxVisible?: number;
}

const props = withDefaults(defineProps<EntityListSectionProps>(), {
  defaultOpen: false,
  maxVisible: 12,
});

const isolateExpandAll = inject(ISOLATE_EXPAND_ALL_KEY, ref(false));

const visibleEntities = computed(() =>
  isolateExpandAll.value ? props.entities : props.entities.slice(0, props.maxVisible),
);

const hasOverflow = computed(() => !isolateExpandAll.value && props.entities.length > props.maxVisible);

const overflowCount = computed(() => props.entities.length - props.maxVisible);
</script>

<template>
  <CollapsibleSection
    v-if="entities.length > 0"
    :title="title"
    :count="entities.length"
    :default-open="defaultOpen"
  >
    <div
      v-for="entity in visibleEntities"
      :key="entity.id"
      class="entity-item"
    >
      <span :class="['entity-badge', badgeClass]">{{ badgeText }}</span>
      <span class="entity-name">{{ entity.name }}</span>
      <span class="entity-detail">{{ entity.detail }}</span>
      <span v-if="entity.tags?.includes('async')" class="entity-tag">async</span>
    </div>
    <div v-if="hasOverflow" class="member-overflow">
      +{{ overflowCount }} more
    </div>
  </CollapsibleSection>
</template>

<style scoped>
.entity-item {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
  line-height: 1.3;
}

.entity-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.entity-badge {
  padding: 0.05rem 0.2rem;
  border-radius: 0.2rem;
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  text-transform: uppercase;
}

.entity-name {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-weight: 700;
  white-space: nowrap;
}

.entity-detail {
  color: var(--text-secondary);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.entity-tag {
  padding: 0.02rem 0.15rem;
  border-radius: 0.15rem;
  font-size: 0.5rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.entity-function {
  background-color: rgba(251, 191, 36, 0.2);
  color: rgb(253, 224, 71);
}

.entity-type {
  background-color: rgba(34, 197, 94, 0.2);
  color: rgb(134, 239, 172);
}

.entity-enum {
  background-color: rgba(244, 114, 182, 0.2);
  color: rgb(249, 168, 212);
}

.entity-const {
  background-color: rgba(56, 189, 248, 0.2);
  color: rgb(125, 211, 252);
}

.entity-var {
  background-color: rgba(251, 146, 60, 0.2);
  color: rgb(253, 186, 116);
}

.member-overflow {
  color: var(--text-secondary);
  font-size: 0.65rem;
  opacity: 0.7;
  padding: 0.15rem 0.35rem;
}
</style>
