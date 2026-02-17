import { computed } from 'vue';

import type { ComputedRef, Ref } from 'vue';

import type { GraphStatCountEntry } from './dependencyGraphCoreTypes';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

export interface UseGraphRenderedStatsOptions {
  visualNodes: Ref<DependencyNode[]>;
  visualEdges: Ref<GraphEdge[]>;
}

export interface GraphRenderedStats {
  renderedNodeCount: ComputedRef<number>;
  renderedEdgeCount: ComputedRef<number>;
  renderedNodeTypeCounts: ComputedRef<GraphStatCountEntry[]>;
  renderedEdgeTypeCounts: ComputedRef<GraphStatCountEntry[]>;
}

const toSortedTypeCounts = (counts: Map<string, number>): GraphStatCountEntry[] =>
  [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.type.localeCompare(b.type)));

export function useGraphRenderedStats(options: UseGraphRenderedStatsOptions): GraphRenderedStats {
  const { visualNodes, visualEdges } = options;

  const renderedNodeCount = computed(() => visualNodes.value.length);
  const renderedEdgeCount = computed(() => visualEdges.value.filter((edge) => !edge.hidden).length);

  const renderedNodeTypeCounts = computed<GraphStatCountEntry[]>(() => {
    const counts = new Map<string, number>();
    visualNodes.value.forEach((node) => {
      const type = node.type ?? 'unknown';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    });
    return toSortedTypeCounts(counts);
  });

  const renderedEdgeTypeCounts = computed<GraphStatCountEntry[]>(() => {
    const counts = new Map<string, number>();
    visualEdges.value.forEach((edge) => {
      if (edge.hidden) return;
      const bundledTypes = edge.data?.bundledTypes ?? [];
      if (bundledTypes.length > 0) {
        [...new Set(bundledTypes)].forEach((type) => {
          counts.set(type, (counts.get(type) ?? 0) + 1);
        });
        return;
      }
      const type = edge.data?.type ?? 'unknown';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    });
    return toSortedTypeCounts(counts);
  });

  return {
    renderedNodeCount,
    renderedEdgeCount,
    renderedNodeTypeCounts,
    renderedEdgeTypeCounts,
  };
}
