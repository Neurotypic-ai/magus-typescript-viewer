<script setup lang="ts">
import type { TypeDisplayModel } from './typeDisplay';

withDefaults(
  defineProps<{
    model: TypeDisplayModel;
    /** Graph nodes default to right-aligned type column; panels often need left. */
    textAlign?: 'left' | 'right';
  }>(),
  { textAlign: 'right' },
);
</script>

<template>
  <div class="type-annotation-root" :class="textAlign === 'left' ? 'type-annotation-root--left' : 'type-annotation-root--right'">
    <template v-if="model.kind === 'plain'">
      <code class="type-annotation-plain">{{ model.raw }}</code>
    </template>

    <ul
      v-else-if="model.kind === 'unionRows' && model.unionMembers"
      class="type-union-list"
      role="list"
    >
      <li v-for="(member, idx) in model.unionMembers" :key="`${idx}-${member}`" role="listitem">
        <code class="type-union-member">{{ member }}</code>
      </li>
    </ul>

    <pre
      v-else-if="model.kind === 'objectBlock' && model.objectBlock"
      class="type-object-block"
      >{{ model.objectBlock }}</pre
    >
  </div>
</template>

<style scoped>
.type-annotation-root {
  min-width: 0;
  max-width: 100%;
}

.type-annotation-root--right {
  text-align: right;
}

.type-annotation-root--right .type-union-list {
  align-items: flex-end;
}

.type-annotation-root--left {
  text-align: left;
}

.type-annotation-root--left .type-union-list {
  align-items: flex-start;
}

.type-annotation-plain {
  display: block;
  color: var(--text-secondary);
  opacity: 0.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: inherit;
  line-height: 1.35;
}

.type-union-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.type-union-member {
  display: block;
  color: var(--text-secondary);
  opacity: 0.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: inherit;
  line-height: 1.35;
}

.type-object-block {
  margin: 0;
  padding: 0.25rem 0.35rem;
  border-radius: 0.25rem;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-secondary);
  opacity: 0.95;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 0.65rem;
  line-height: 1.4;
  max-height: 12rem;
  overflow: auto;
  text-align: left;
}
</style>
