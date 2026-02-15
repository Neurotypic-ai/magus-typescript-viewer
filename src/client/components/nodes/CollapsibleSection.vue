<script setup lang="ts">
import { ref } from 'vue';

import { useIsolateExpandState } from '../../composables/useIsolateExpandState';

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

useIsolateExpandState(
  () => isOpen.value,
  (saved) => { isOpen.value = saved; },
  () => { isOpen.value = true; },
);
</script>

<template>
  <div class="collapsible-section">
    <button class="collapsible-section-toggle nodrag" type="button" @click.stop="toggle">
      <span class="collapsible-section-title">{{ title }} ({{ count }})</span>
      <span class="collapsible-section-indicator">{{ isOpen ? '\u2212' : '+' }}</span>
    </button>
    <div :class="['collapsible-section-grid', { 'collapsible-section-grid--open': isOpen }]">
      <div class="collapsible-section-content nowheel">
        <slot />
      </div>
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

.collapsible-section-grid {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

.collapsible-section-grid--open {
  grid-template-rows: 1fr;
}

.collapsible-section-content {
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-top: 0.35rem;
  opacity: 0;
  transition: opacity 200ms 80ms ease-out;
}

.collapsible-section-grid--open > .collapsible-section-content {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .collapsible-section-grid {
    transition: none;
  }
  .collapsible-section-content {
    transition: none;
  }
}
</style>
