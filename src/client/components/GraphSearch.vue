<script setup lang="ts">
const props = defineProps<{
  runSearch: () => void;
}>();

const modelValue = defineModel<string>({ required: true });
</script>

<template>
  <div class="flex gap-2">
    <label for="graph-search-input" class="sr-only">Search nodes</label>
    <input
      id="graph-search-input"
      v-model="modelValue"
      type="search"
      placeholder="Search nodes..."
      autocomplete="off"
      class="flex-1 px-3 py-1.5 bg-white/10 text-text-primary rounded border border-border-default text-xs focus:outline-none focus:border-primary-main focus:ring-1 focus:ring-primary-main"
      aria-label="Search nodes in graph"
      @keydown.enter="props.runSearch()"
    />
    <button
      type="button"
      class="px-3 py-1.5 bg-primary-main text-white rounded hover:bg-primary-dark transition-fast text-xs font-medium"
      aria-label="Run search"
      @click="props.runSearch()"
    >
      Search
    </button>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
