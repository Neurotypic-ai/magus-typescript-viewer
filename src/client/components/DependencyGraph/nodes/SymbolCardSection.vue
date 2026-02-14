<script setup lang="ts">
import CollapsibleSection from './CollapsibleSection.vue';
import MemberListSection from './MemberListSection.vue';

import type { FormattedMember } from './utils';

export interface FormattedSymbol {
  id: string;
  type: 'class' | 'interface';
  name: string;
  formattedProperties: FormattedMember[];
  formattedMethods: FormattedMember[];
}

interface SymbolCardSectionProps {
  title: string;
  symbols: FormattedSymbol[];
  badgeText: string;
  badgeClass: string;
  expandedSymbols: Set<string>;
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<SymbolCardSectionProps>(), {
  defaultOpen: true,
});

const emit = defineEmits<{
  'toggle-symbol': [id: string];
}>();

const isExpanded = (id: string) => props.expandedSymbols.has(id);

const memberCount = (symbol: FormattedSymbol) =>
  symbol.formattedProperties.length + symbol.formattedMethods.length;
</script>

<template>
  <CollapsibleSection
    v-if="symbols.length > 0"
    :title="title"
    :count="symbols.length"
    :default-open="defaultOpen"
  >
    <div v-for="symbol in symbols" :key="symbol.id" class="symbol-card">
      <button class="symbol-card-header nodrag" type="button" @click.stop="emit('toggle-symbol', symbol.id)">
        <span class="symbol-card-name">{{ symbol.name }}</span>
        <span class="symbol-card-count">{{ memberCount(symbol) }}</span>
        <span class="symbol-card-spacer" />
        <span :class="['symbol-card-badge', badgeClass]">{{ badgeText }}</span>
        <span class="symbol-card-toggle">{{ isExpanded(symbol.id) ? '\u2212' : '+' }}</span>
      </button>
      <div v-if="isExpanded(symbol.id)" class="symbol-card-body">
        <MemberListSection
          title="Properties"
          :members="symbol.formattedProperties"
          :symbol-id="symbol.id"
          key-prefix="prop"
        />
        <MemberListSection
          title="Methods"
          :members="symbol.formattedMethods"
          :symbol-id="symbol.id"
          key-prefix="method"
          :append-parens="true"
        />
      </div>
    </div>
  </CollapsibleSection>
</template>

<style scoped>
.symbol-card {
  border: 1px solid rgba(var(--border-default-rgb), 0.4);
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.02);
}

.symbol-card-header {
  width: 100%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  font-size: 0.72rem;
}

.symbol-card-header:hover {
  background: rgba(255, 255, 255, 0.08);
}

.symbol-card-name {
  color: var(--text-primary);
  font-weight: 600;
  white-space: nowrap;
}

.symbol-card-count {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.62rem;
  opacity: 0.7;
  flex-shrink: 0;
}

.symbol-card-spacer {
  flex: 1;
}

.symbol-card-badge {
  padding: 0.1rem 0.25rem;
  border-radius: 0.2rem;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.symbol-card-toggle {
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1;
  user-select: none;
  flex-shrink: 0;
}

.symbol-card-body {
  padding: 0.35rem 0.5rem 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.type-class {
  background-color: rgba(59, 130, 246, 0.2);
  color: rgb(147, 197, 253);
}

.type-interface {
  background-color: rgba(168, 85, 247, 0.2);
  color: rgb(216, 180, 254);
}
</style>
