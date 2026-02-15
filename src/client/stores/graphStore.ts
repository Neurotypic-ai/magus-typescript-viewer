import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

import type { Ref, ShallowRef } from 'vue';

import type { DependencyNode, GraphEdge } from '../components/DependencyGraph/types';

export type GraphViewMode = 'overview' | 'isolate' | 'moduleDrilldown' | 'symbolDrilldown';

// Cache keys for local storage
const CACHE_VERSION = 'v1';
const NODES_CACHE_KEY = `${CACHE_VERSION}:typescript-viewer-nodes`;
const EDGES_CACHE_KEY = `${CACHE_VERSION}:typescript-viewer-edges`;
const CACHE_DEBOUNCE_MS = 500;
const MAX_CACHEABLE_NODE_COUNT = 1200;
const MAX_CACHEABLE_EDGE_COUNT = 5000;

interface GraphStore {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  selectedNode: Ref<DependencyNode | null>;
  cacheKey: Ref<string | null>;
  viewMode: Ref<GraphViewMode>;
  overviewSnapshot: Ref<{ nodes: DependencyNode[]; edges: GraphEdge[] } | null>;
  semanticSnapshot: ShallowRef<{ nodes: DependencyNode[]; edges: GraphEdge[] } | null>;
  setNodes: (newNodes: DependencyNode[]) => void;
  setEdges: (newEdges: GraphEdge[]) => void;
  updateNodesById: (updates: Map<string, DependencyNode>) => void;
  updateEdgesById: (updates: Map<string, GraphEdge>) => void;
  setEdgeVisibility: (visibilityMap: Map<string, boolean>) => void;
  setSelectedNode: (node: DependencyNode | null) => void;
  setCacheKey: (key: string | null) => void;
  setViewMode: (mode: GraphViewMode) => void;
  setOverviewSnapshot: (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null) => void;
  setSemanticSnapshot: (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null) => void;
  restoreOverviewSnapshot: () => boolean;
  clearCache: () => void;
  suspendCacheWrites: () => void;
  resumeCacheWrites: () => void;
}

function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
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
  const viewMode = ref<GraphViewMode>('overview');
  const overviewSnapshot = ref<{ nodes: DependencyNode[]; edges: GraphEdge[] } | null>(null);
  const semanticSnapshot = shallowRef<{ nodes: DependencyNode[]; edges: GraphEdge[] } | null>(null);
  const cacheWriteSuspended = ref(false);

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

  const writeCache = debounce((nodesToCache: DependencyNode[], edgesToCache: GraphEdge[]) => {
    if (nodesToCache.length > MAX_CACHEABLE_NODE_COUNT || edgesToCache.length > MAX_CACHEABLE_EDGE_COUNT) {
      return;
    }

    const doWrite = () => {
      try {
        if (nodesToCache.length > 0) {
          localStorage.setItem(NODES_CACHE_KEY, JSON.stringify(nodesToCache));
        }
        if (edgesToCache.length > 0) {
          localStorage.setItem(EDGES_CACHE_KEY, JSON.stringify(edgesToCache));
        }
      } catch {
        // Silently fail if cache storage fails
      }
    };

    // Defer heavy JSON.stringify to idle time so it doesn't block interactions
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(doWrite, { timeout: 2000 });
    } else {
      setTimeout(doWrite, 0);
    }
  }, CACHE_DEBOUNCE_MS);

  // Watch for reference changes to nodes/edges and update cache when we have a cache key.
  // Shallow watch is sufficient since setNodes/setEdges replace the entire array reference.
  // Avoids expensive deep comparison on large graphs (drag/hover would trigger O(n×m) diffs).
  watch([nodes, edges, cacheKey], ([newNodes, newEdges, newCacheKey]) => {
    if (!newCacheKey || cacheWriteSuspended.value) return;
    writeCache(newNodes, newEdges);
  });

  // Actions
  const setNodes = (newNodes: DependencyNode[]) => {
    nodes.value = newNodes;
  };

  const setEdges = (newEdges: GraphEdge[]) => {
    edges.value = newEdges;
  };

  const updateNodesById = (updates: Map<string, DependencyNode>) => {
    if (updates.size === 0 || nodes.value.length === 0) {
      return;
    }

    let nextNodes: DependencyNode[] | null = null;
    const nodeIndexById = new Map<string, number>();
    nodes.value.forEach((node, index) => {
      nodeIndexById.set(node.id, index);
    });

    updates.forEach((nextNode, nodeId) => {
      const nodeIndex = nodeIndexById.get(nodeId);
      if (nodeIndex === undefined) {
        return;
      }

      const current = (nextNodes ?? nodes.value)[nodeIndex];
      if (current === nextNode) {
        return;
      }

      if (!nextNodes) {
        nextNodes = [...nodes.value];
      }

      nextNodes[nodeIndex] = nextNode;
    });

    if (nextNodes) {
      nodes.value = nextNodes;
    }
  };

  const updateEdgesById = (updates: Map<string, GraphEdge>) => {
    if (updates.size === 0 || edges.value.length === 0) {
      return;
    }

    let nextEdges: GraphEdge[] | null = null;
    const edgeIndexById = new Map<string, number>();
    edges.value.forEach((edge, index) => {
      edgeIndexById.set(edge.id, index);
    });

    updates.forEach((nextEdge, edgeId) => {
      const edgeIndex = edgeIndexById.get(edgeId);
      if (edgeIndex === undefined) {
        return;
      }

      const current = (nextEdges ?? edges.value)[edgeIndex];
      if (current === nextEdge) {
        return;
      }

      if (!nextEdges) {
        nextEdges = [...edges.value];
      }

      nextEdges[edgeIndex] = nextEdge;
    });

    if (nextEdges) {
      edges.value = nextEdges;
    }
  };

  const setEdgeVisibility = (visibilityMap: Map<string, boolean>) => {
    if (visibilityMap.size === 0 || edges.value.length === 0) {
      return;
    }

    let updated: GraphEdge[] | null = null;
    const edgeIndexById = new Map<string, number>();
    edges.value.forEach((edge, index) => {
      edgeIndexById.set(edge.id, index);
    });

    visibilityMap.forEach((hidden, edgeId) => {
      const edgeIndex = edgeIndexById.get(edgeId);
      if (edgeIndex === undefined) {
        return;
      }

      const current = (updated ?? edges.value)[edgeIndex];
      if (!current || current.hidden === hidden) {
        return;
      }

      if (!updated) {
        updated = [...edges.value];
      }

      updated[edgeIndex] = {
        ...current,
        hidden,
      };
    });

    if (updated) {
      edges.value = updated;
    }
  };

  const setSelectedNode = (node: DependencyNode | null) => {
    selectedNode.value = node;
  };

  const setCacheKey = (key: string | null) => {
    cacheKey.value = key;
  };

  const setViewMode = (mode: GraphViewMode) => {
    viewMode.value = mode;
  };

  const setOverviewSnapshot = (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null) => {
    overviewSnapshot.value = snapshot;
  };

  const setSemanticSnapshot = (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null) => {
    semanticSnapshot.value = snapshot;
  };

  const restoreOverviewSnapshot = (): boolean => {
    const snapshot = overviewSnapshot.value;
    if (!snapshot) {
      return false;
    }
    nodes.value = snapshot.nodes;
    edges.value = snapshot.edges;
    return true;
  };

  const clearCache = (): void => {
    try {
      localStorage.removeItem(NODES_CACHE_KEY);
      localStorage.removeItem(EDGES_CACHE_KEY);
      nodes.value = [];
      edges.value = [];
      selectedNode.value = null;
      cacheKey.value = null;
      viewMode.value = 'overview';
      overviewSnapshot.value = null;
      semanticSnapshot.value = null;
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
    viewMode,
    overviewSnapshot,
    semanticSnapshot,
    // Actions
    setNodes,
    setEdges,
    updateNodesById,
    updateEdgesById,
    setEdgeVisibility,
    setSelectedNode,
    setCacheKey,
    setViewMode,
    setOverviewSnapshot,
    setSemanticSnapshot,
    restoreOverviewSnapshot,
    clearCache,
    suspendCacheWrites: () => {
      cacheWriteSuspended.value = true;
    },
    resumeCacheWrites: () => {
      cacheWriteSuspended.value = false;
    },
  };
});
