<script setup lang="ts">
import { ref } from 'vue';

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
</script>

<template>
  <div class="collapsible-section">
    <button class="collapsible-section-toggle" type="button" @click.stop="toggle">
      <span class="collapsible-section-title">{{ title }} ({{ count }})</span>
      <span class="collapsible-section-indicator">{{ isOpen ? '\u2212' : '+' }}</span>
    </button>
    <Transition name="section-collapse">
      <div v-if="isOpen" class="collapsible-section-content">
        <slot />
      </div>
    </Transition>
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

.section-collapse-enter-active,
.section-collapse-leave-active {
  transition:
    opacity 160ms ease-out,
    transform 160ms ease-out;
}

.section-collapse-enter-from,
.section-collapse-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
