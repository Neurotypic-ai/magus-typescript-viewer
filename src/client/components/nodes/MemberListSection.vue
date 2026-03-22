<script setup lang="ts">
import CollapsibleSection from './CollapsibleSection.vue';
import TypeAnnotationDisplay from './TypeAnnotationDisplay.vue';

import type { FormattedMember } from './utils';

interface MemberListSectionProps {
  title: string;
  members: FormattedMember[];
  symbolId: string;
  keyPrefix: string;
  appendParens?: boolean;
  defaultOpen?: boolean;
}

withDefaults(defineProps<MemberListSectionProps>(), {
  appendParens: false,
  defaultOpen: true,
});
</script>

<template>
  <CollapsibleSection
    v-if="members.length > 0"
    :title="title"
    :count="members.length"
    :default-open="defaultOpen"
  >
    <div
      v-for="member in members"
      :key="`${keyPrefix}-${symbolId}-${member.key}`"
      class="member-item"
      :class="{ 'member-item--rich': member.typeDisplay.kind !== 'plain' }"
    >
      <span class="member-name">{{ member.name }}{{ appendParens ? '()' : '' }}</span>
      <span v-if="member.typeDisplay.kind === 'plain'" class="member-type-annotation">{{ member.typeAnnotation }}</span>
      <TypeAnnotationDisplay v-else :model="member.typeDisplay" />
    </div>
  </CollapsibleSection>
</template>

<style scoped>
.member-item {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 0.35rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.68rem;
  line-height: 1.3;
}

.member-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.member-name {
  color: var(--text-primary);
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

.member-type-annotation {
  color: var(--text-secondary);
  opacity: 0.85;
  margin-left: auto;
  text-align: right;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  min-width: 0;
}

.member-item--rich {
  align-items: stretch;
}

.member-item--rich > :deep(.type-annotation-root) {
  flex: 1 1 100%;
  min-width: 0;
}

</style>
