<script setup lang="ts">
import { computed } from 'vue';

interface MeasureBaseNodeProps {
  label: string;
  badgeText: string;
  badgeClass?: string;
  minWidth?: string;
  isContainer?: boolean;
  showSubnodes?: boolean;
  subnodesCount?: number;
  surfaceStyle?: Record<string, string | number> | undefined;
}

const props = withDefaults(defineProps<MeasureBaseNodeProps>(), {
  minWidth: '280px',
  isContainer: false,
  showSubnodes: false,
  subnodesCount: 0,
  surfaceStyle: undefined,
});

const containerClasses = computed(() => ({
  'base-node-container': true,
  'base-node-container--container': props.isContainer,
}));

const containerStyle = computed(() => {
  const styleBase = props.surfaceStyle ?? {};
  const { width: _width, height: _height, zIndex: _zIndex, ...rest } = styleBase;
  return {
    ...rest,
    minWidth: props.minWidth ?? rest['minWidth'],
  };
});
</script>

<template>
  <div :class="containerClasses" :style="containerStyle">
    <div class="base-node-header">
      <div class="base-node-title-container">
        <div class="base-node-title" :title="label">
          {{ label || 'Unnamed' }}
        </div>
      </div>
      <div :class="['base-node-badge', badgeClass]">
        {{ badgeText }}
      </div>
    </div>

    <section class="base-node-body">
      <slot name="body" />
    </section>

    <section v-if="showSubnodes" class="base-node-subnodes">
      <div class="base-node-subnodes-header">
        <span>Subnodes</span>
        <span class="base-node-subnodes-count">{{ subnodesCount }}</span>
      </div>
      <div class="base-node-subnodes-content">
        <slot name="subnodes">
          <div class="base-node-subnodes-empty">No subnodes</div>
        </slot>
      </div>
    </section>
  </div>
</template>

<style scoped>
.base-node-container {
  position: relative;
  border-radius: 0.5rem;
  border: 1px solid var(--border-default);
  background-color: var(--background-node);
  contain: layout style;
  font-size: 0.75rem;
  line-height: 1rem;
  display: flex;
  flex-direction: column;
  cursor: default;
}

.base-node-container--container {
  border-radius: 0.625rem;
  overflow: visible;
}

.base-node-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-bottom: 1px solid var(--border-default);
  padding: 0.45rem 0.5rem;
  min-height: 42px;
}

.base-node-title-container {
  flex: 1;
  min-width: 0;
}

.base-node-title {
  font-weight: 600;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.base-node-badge {
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  flex-shrink: 0;
}

.base-node-badge.type-module {
  background-color: var(--graph-badge-module-bg);
  color: var(--graph-badge-module-text);
}

.base-node-badge.type-class {
  background-color: var(--graph-badge-class-bg);
  color: var(--graph-badge-class-text);
}

.base-node-badge.type-interface {
  background-color: var(--graph-badge-interface-bg);
  color: var(--graph-badge-interface-text);
}

.base-node-badge.type-property {
  background-color: var(--graph-badge-property-bg);
  color: var(--graph-badge-property-text);
}

.base-node-badge.type-method {
  background-color: var(--graph-badge-method-bg);
  color: var(--graph-badge-method-text);
}

.base-node-badge.type-default {
  background-color: var(--graph-badge-default-bg);
  color: var(--text-secondary);
}

.base-node-badge.package-badge {
  background-color: var(--background-node-package);
}

.base-node-body {
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid rgba(var(--border-default-rgb), 0.35);
}

.base-node-subnodes {
  display: flex;
  flex-direction: column;
  min-height: 44px;
}

.base-node-subnodes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.5rem;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
}

.base-node-subnodes-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.7rem;
}

.base-node-subnodes-content {
  padding: 0 0.5rem 0.45rem 0.5rem;
}

.base-node-subnodes-empty {
  font-size: 0.7rem;
  color: var(--text-secondary);
  opacity: 0.75;
}
</style>
