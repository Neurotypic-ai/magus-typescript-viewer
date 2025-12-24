import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import type { Ref } from 'vue';

import type { DependencyNode, GraphEdge } from '../components/DependencyGraph/types';

// Cache keys for local storage
const NODES_CACHE_KEY = 'typescript-viewer-nodes';
const EDGES_CACHE_KEY = 'typescript-viewer-edges';

interface GraphStore {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  selectedNode: Ref<DependencyNode | null>;
  cacheKey: Ref<string | null>;
  setNodes: (newNodes: DependencyNode[]) => void;
  setEdges: (newEdges: GraphEdge[]) => void;
  setSelectedNode: (node: DependencyNode | null) => void;
  setCacheKey: (key: string | null) => void;
  clearCache: () => void;
}

/**
 * Pinia store for graph state management
 */
export const useGraphStore = defineStore('graph', (): GraphStore => {
  // State
  const nodes = ref<DependencyNode[]>([]);
  const edges = ref<GraphEdge[]>([]);
  const selectedNode = ref<DependencyNode | null>(null);
  const cacheKey = ref<string | null>(null);

  // Load cached data from localStorage on initialization
  const loadCache = () => {
    try {
      const cachedNodesJson = localStorage.getItem(NODES_CACHE_KEY);
      const cachedEdgesJson = localStorage.getItem(EDGES_CACHE_KEY);

      if (cachedNodesJson && cachedEdgesJson) {
        const cachedNodes = JSON.parse(cachedNodesJson) as DependencyNode[];
        const cachedEdges = JSON.parse(cachedEdgesJson) as GraphEdge[];

        nodes.value = cachedNodes;
        edges.value = cachedEdges;
      }
    } catch {
      // Continue with empty state if cache load fails
    }
  };

  // Watch for changes to nodes/edges and update cache when we have a cache key
  watch(
    [nodes, edges, cacheKey],
    ([newNodes, newEdges, newCacheKey]) => {
      if (!newCacheKey) return;

      try {
        if (newNodes.length > 0) {
          localStorage.setItem(NODES_CACHE_KEY, JSON.stringify(newNodes));
        }

        if (newEdges.length > 0) {
          localStorage.setItem(EDGES_CACHE_KEY, JSON.stringify(newEdges));
        }
      } catch {
        // Silently fail if cache storage fails
      }
    },
    { deep: true }
  );

  // Actions
  const setNodes = (newNodes: DependencyNode[]) => {
    nodes.value = newNodes;
  };

  const setEdges = (newEdges: GraphEdge[]) => {
    edges.value = newEdges;
  };

  const setSelectedNode = (node: DependencyNode | null) => {
    selectedNode.value = node;
  };

  const setCacheKey = (key: string | null) => {
    cacheKey.value = key;
  };

  const clearCache = (): void => {
    try {
      localStorage.removeItem(NODES_CACHE_KEY);
      localStorage.removeItem(EDGES_CACHE_KEY);
      nodes.value = [];
      edges.value = [];
      selectedNode.value = null;
      cacheKey.value = null;
    } catch {
      // Silently fail if cache clearing fails
    }
  };

  // Initialize cache on store creation
  loadCache();

  return {
    // State
    nodes,
    edges,
    selectedNode,
    cacheKey,
    // Actions
    setNodes,
    setEdges,
    setSelectedNode,
    setCacheKey,
    clearCache,
  };
});
