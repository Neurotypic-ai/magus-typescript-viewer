/**
 * useGraphSearch — shared-state composable for graph node search.
 * Single source of truth consumed by GraphControls (UI) and DependencyGraph (result handling).
 */

import { type Ref, ref, watch } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { SearchResult } from '../types/SearchResult';

export interface UseGraphSearchOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  onSearchResult: (result: SearchResult) => void;
  debounceMs?: number;
}

export interface UseGraphSearchResult {
  searchQuery: Ref<string>;
  runSearch: () => void;
  clearSearch: () => void;
}

export function useGraphSearch(options: UseGraphSearchOptions): UseGraphSearchResult {
  const { nodes, edges, onSearchResult, debounceMs = 300 } = options;

  const searchQuery = ref('');

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  const runSearch = (): void => {
    const query = searchQuery.value.trim();
    if (!query) {
      onSearchResult({ nodes: [], edges: [], path: [] });
      return;
    }

    const q = query.toLowerCase();
    const matchingNodes = nodes.value.filter((node) =>
      (node.data?.label ?? '').toLowerCase().includes(q)
    );
    const matchingNodeIds = new Set(matchingNodes.map((n) => n.id));
    const relatedEdges = edges.value.filter(
      (edge) => matchingNodeIds.has(edge.source) || matchingNodeIds.has(edge.target)
    );

    onSearchResult({
      nodes: matchingNodes,
      edges: relatedEdges,
      path: matchingNodes,
    });
  };

  watch(
    searchQuery,
    () => {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(runSearch, debounceMs);
    },
    { flush: 'sync' }
  );

  const clearSearch = (): void => {
    searchQuery.value = '';
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    onSearchResult({ nodes: [], edges: [], path: [] });
  };

  return {
    searchQuery,
    runSearch,
    clearSearch,
  };
}
