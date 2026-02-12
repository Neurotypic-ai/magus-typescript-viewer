<script setup lang="ts">
import { ref, watch } from 'vue';

import { Panel } from '@vue-flow/core';

import type { DependencyNode, SearchResult } from '../types';
import type { GraphEdge } from '../types';

interface GraphSearchProps {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

const props = defineProps<GraphSearchProps>();
const emit = defineEmits<{
  'search-result': [result: SearchResult];
}>();

const searchQuery = ref('');

// Debounce timer for search input
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const handleSearch = () => {
  if (!searchQuery.value) {
    emit('search-result', { nodes: [], edges: [], path: [] });
    return;
  }

  // Lowercase query once instead of per-node
  const query = searchQuery.value.toLowerCase();
  const matchingNodes = props.nodes.filter((node) =>
    node.data?.label.toLowerCase().includes(query)
  );

  // Build a Set of matching node IDs for O(1) lookups instead of O(n*m) .some()
  const matchingNodeIds = new Set(matchingNodes.map((n) => n.id));

  const relatedEdges = props.edges.filter((edge) =>
    matchingNodeIds.has(edge.source) || matchingNodeIds.has(edge.target)
  );

  emit('search-result', {
    nodes: matchingNodes,
    edges: relatedEdges,
    path: matchingNodes,
  });
};

// Enter key triggers immediate search (bypasses debounce)
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    if (searchTimeout) clearTimeout(searchTimeout);
    handleSearch();
  }
};

// Watch searchQuery with 300ms debounce for auto-search on typing
watch(searchQuery, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(handleSearch, 300);
});
</script>

<template>
  <Panel position="top-right" class="mt-2 mr-2">
    <div class="flex gap-2 bg-background-paper p-2 rounded-lg border border-gray-700 shadow-lg max-w-sm">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search nodes..."
        @keydown="handleKeyDown"
        class="px-3 py-1 bg-gray-800 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
      />
      <button
        @click="handleSearch"
        class="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors border border-gray-600"
      >
        Search
      </button>
    </div>
  </Panel>
</template>
