<script setup lang="ts">
import { ref } from 'vue';

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

const handleSearch = () => {
  if (!searchQuery.value) {
    emit('search-result', { nodes: [], edges: [], path: [] });
    return;
  }

  const matchingNodes = props.nodes.filter((node) =>
    node.data?.label.toLowerCase().includes(searchQuery.value.toLowerCase())
  );

  const relatedEdges = props.edges.filter((edge) =>
    matchingNodes.some((node) => node.id === edge.source || node.id === edge.target)
  );

  emit('search-result', {
    nodes: matchingNodes,
    edges: relatedEdges,
    path: matchingNodes,
  });
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    handleSearch();
  }
};
</script>

<template>
  <Panel position="top-left" class="mt-24">
    <div class="flex gap-2 bg-background-paper p-2 rounded-lg border border-gray-700 shadow-lg">
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
