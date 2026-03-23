<script setup lang="ts">
import { computed } from 'vue';

import CollapsibleSection from './CollapsibleSection.vue';
import TypeAnnotationDisplay from './TypeAnnotationDisplay.vue';

import { buildDetailDisplayModel, type TypeDisplayModel } from './typeDisplay';

import type { EmbeddedModuleEntity } from '../../../shared/types/graph/EmbeddedModuleEntity';

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

const rows = computed(() =>
  props.entities.map((entity) => ({
    entity,
    model: buildDetailDisplayModel(entity.detail),
  })),
);

function isRichDetail(model: TypeDisplayModel): boolean {
  return model.kind !== 'plain';
}
</script>

<template>
  <CollapsibleSection
    v-if="entities.length > 0"
    :title="title"
    :count="entities.length"
    :default-open="defaultOpen"
  >
    <div
      v-for="({ entity, model }) in rows"
      :key="entity.id"
      class="entity-item"
      :class="{ 'entity-item--rich': isRichDetail(model) }"
    >
      <div class="entity-row-main">
        <span :class="['entity-badge', badgeClass]">{{ badgeText }}</span>
        <span class="entity-name">{{ entity.name }}</span>
        <span v-if="model.kind === 'plain'" class="entity-detail">{{ entity.detail }}</span>
        <span v-if="entity.tags?.includes('async')" class="entity-tag">async</span>
      </div>
      <TypeAnnotationDisplay
        v-if="model.kind !== 'plain'"
        text-align="left"
        :model="model"
      />
    </div>
  </CollapsibleSection>
</template>

<style scoped>
.entity-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
  line-height: 1.3;
}

.entity-item:not(.entity-item--rich) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem;
}

.entity-item:not(.entity-item--rich) .entity-row-main {
  display: contents;
}

.entity-item--rich .entity-row-main {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem;
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
  opacity: 0.85;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  margin-left: auto;
  text-align: right;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.entity-item--rich .entity-detail {
  margin-left: 0;
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

.entity-item--rich > :deep(.type-annotation-root) {
  width: 100%;
  min-width: 0;
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

</style>
