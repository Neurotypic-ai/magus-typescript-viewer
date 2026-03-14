<script setup lang="ts">
import { computed } from 'vue';

import CollapsibleSection from './CollapsibleSection.vue';

import type { EmbeddedModuleEntity } from '../../types/EmbeddedModuleEntity';

interface EntityListSectionProps {
  title: string;
  entities: EmbeddedModuleEntity[];
  badgeText: string;
  badgeClass: string;
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<EntityListSectionProps>(), {
  defaultOpen: false,
});

const visibleEntities = computed(() => props.entities);
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
  font-family: var(--font-mono);
  font-weight: 700;
  white-space: nowrap;
}

.entity-detail {
  color: var(--text-secondary);
  opacity: 0.8;
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
  background-color: var(--badge-function-bg);
  color: var(--badge-function-text);
  border: 1px solid rgba(16, 185, 129, 0.15);
}

.entity-type {
  background-color: var(--badge-type-bg);
  color: var(--badge-type-text);
  border: 1px solid rgba(99, 102, 241, 0.15);
}

.entity-enum {
  background-color: var(--badge-enum-bg);
  color: var(--badge-enum-text);
  border: 1px solid rgba(236, 72, 153, 0.15);
}

.entity-const {
  background-color: var(--badge-const-bg);
  color: var(--badge-const-text);
  border: 1px solid rgba(20, 184, 166, 0.15);
}

.entity-var {
  background-color: var(--badge-var-bg);
  color: var(--badge-var-text);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

</style>
