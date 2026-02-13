<script setup lang="ts">
import { inject, ref, watch } from 'vue';

import { ISOLATE_EXPAND_ALL_KEY } from './utils';

interface CollapsibleSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<CollapsibleSectionProps>(), {
  defaultOpen: true,
});

const isOpen = ref(props.defaultOpen);

const toggle = () => {
  isOpen.value = !isOpen.value;
};

const isolateExpandAll = inject(ISOLATE_EXPAND_ALL_KEY, ref(false));
watch(isolateExpandAll, (expand) => {
  if (expand) {
    isOpen.value = true;
  }
});
</script>

<template>
  <div class="collapsible-section">
    <button class="collapsible-section-toggle nodrag" type="button" @click.stop="toggle">
      <span class="collapsible-section-title">{{ title }} ({{ count }})</span>
      <span class="collapsible-section-indicator">{{ isOpen ? '\u2212' : '+' }}</span>
    </button>
    <div v-if="isOpen" class="collapsible-section-content nowheel">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.collapsible-section + .collapsible-section {
  margin-top: 0.5rem;
}

.collapsible-section-toggle {
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
}

.collapsible-section-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}

.collapsible-section-title {
  user-select: none;
}

.collapsible-section-indicator {
  user-select: none;
  font-size: 0.75rem;
  line-height: 1;
}

.collapsible-section-content {
  margin-top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

</style>
