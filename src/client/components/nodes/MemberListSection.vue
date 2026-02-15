<script setup lang="ts">
import CollapsibleSection from './CollapsibleSection.vue';

import type { FormattedMember } from './utils';

interface MemberListSectionProps {
  title: string;
  members: FormattedMember[];
  symbolId: string;
  keyPrefix: string;
  appendParens?: boolean;
  maxVisible?: number;
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<MemberListSectionProps>(), {
  appendParens: false,
  maxVisible: 8,
  defaultOpen: true,
});

const visibleMembers = () => props.members.slice(0, props.maxVisible);
</script>

<template>
  <CollapsibleSection
    v-if="members.length > 0"
    :title="title"
    :count="members.length"
    :default-open="defaultOpen"
  >
    <div
      v-for="member in visibleMembers()"
      :key="`${keyPrefix}-${symbolId}-${member.key}`"
      class="member-item"
    >
      <span class="member-name">{{ member.name }}{{ appendParens ? '()' : '' }}</span>
      <span class="member-type-annotation">{{ member.typeAnnotation }}</span>
    </div>
    <div v-if="members.length > maxVisible" class="member-overflow">
      +{{ members.length - maxVisible }} more
    </div>
  </CollapsibleSection>
</template>

<style scoped>
.member-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
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
