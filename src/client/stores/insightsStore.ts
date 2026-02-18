import { defineStore, type SetupStoreDefinition } from 'pinia';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { getApiBaseUrl } from '../assemblers/api';

import type { InsightKind, InsightReport, InsightResult } from '../../server/insights/types';

interface InsightsStore {
  report: Ref<InsightReport | null>;
  loading: Ref<boolean>;
  activeFilter: Ref<InsightKind | null>;
  dashboardOpen: Ref<boolean>;
  insightsByNodeId: ComputedRef<Map<string, InsightResult[]>>;
  filteredNodeIds: ComputedRef<Set<string>>;
  nodeSeverityCounts: (nodeId: string) => { critical: number; warning: number; info: number };
  fetchInsights: (packageId?: string) => Promise<void>;
  setActiveFilter: (kind: InsightKind | null) => void;
  toggleDashboard: () => void;
}

const createInsightsStore = (): InsightsStore => {
  const report = ref<InsightReport | null>(null);
  const loading = ref(false);
  const activeFilter = ref<InsightKind | null>(null);
  const dashboardOpen = ref(false);

  /** Map from entity/node ID → insights that reference it */
  const insightsByNodeId = computed(() => {
    const map = new Map<string, InsightResult[]>();
    if (!report.value) return map;

    for (const insight of report.value.insights) {
      for (const entity of insight.entities) {
        let arr = map.get(entity.id);
        if (!arr) {
          arr = [];
          map.set(entity.id, arr);
        }
        arr.push(insight);

        // Also index by moduleId if present
        if (entity.moduleId && entity.moduleId !== entity.id) {
          let modArr = map.get(entity.moduleId);
          if (!modArr) {
            modArr = [];
            map.set(entity.moduleId, modArr);
          }
          modArr.push(insight);
        }
      }
    }
    return map;
  });

  /** Set of node IDs affected by the active filter */
  const filteredNodeIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    if (!activeFilter.value || !report.value) return set;
    const kind = activeFilter.value;
    for (const insight of report.value.insights) {
      if (insight.type !== kind) continue;
      for (const entity of insight.entities) {
        set.add(entity.id);
        if (entity.moduleId) set.add(entity.moduleId);
      }
    }
    return set;
  });

  /** Severity counts for a given node */
  function nodeSeverityCounts(nodeId: string): { critical: number; warning: number; info: number } {
    const counts = { critical: 0, warning: 0, info: 0 };
    const nodeInsights = insightsByNodeId.value.get(nodeId);
    if (!nodeInsights) return counts;

    // Deduplicate by insight type to avoid counting the same insight multiple times
    const seen = new Set<InsightKind>();
    for (const insight of nodeInsights) {
      if (seen.has(insight.type)) continue;
      seen.add(insight.type);
      counts[insight.severity]++;
    }
    return counts;
  }

  async function fetchInsights(packageId?: string): Promise<void> {
    loading.value = true;
    try {
      const baseUrl = getApiBaseUrl();
      const url = packageId ? `${baseUrl}/insights?packageId=${encodeURIComponent(packageId)}` : `${baseUrl}/insights`;
      const response = await fetch(url);
      if (!response.ok) {
        report.value = null;
        return;
      }
      const data = (await response.json()) as InsightReport;
      report.value = data;
    } catch {
      report.value = null;
    } finally {
      loading.value = false;
    }
  }

  function setActiveFilter(kind: InsightKind | null): void {
    activeFilter.value = kind;
  }

  function toggleDashboard(): void {
    dashboardOpen.value = !dashboardOpen.value;
  }

  return {
    report: report,
    loading: loading,
    activeFilter: activeFilter,
    dashboardOpen: dashboardOpen,
    insightsByNodeId: insightsByNodeId,
    filteredNodeIds: filteredNodeIds,
    nodeSeverityCounts: nodeSeverityCounts,
    fetchInsights: fetchInsights,
    setActiveFilter: setActiveFilter,
    toggleDashboard: toggleDashboard,
  };
};

export const useInsightsStore: SetupStoreDefinition<
  'insights',
  InsightsStore
> = defineStore('insights', createInsightsStore);
