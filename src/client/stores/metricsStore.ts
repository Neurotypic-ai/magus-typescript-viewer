import { computed, ref } from 'vue';

import { defineStore } from 'pinia';

import { getApiBaseUrl } from '../assemblers/api';

import type { SetupStoreDefinition } from 'pinia';
import type { ComputedRef, Ref } from 'vue';

export interface EntityMetric {
  id: string;
  snapshot_id: string;
  package_id: string | null;
  module_id: string | null;
  entity_id: string | null;
  entity_type: string;
  metric_key: string;
  metric_value: number;
  metric_category: string;
}

export interface DependencyCycle {
  id: string;
  package_id: string | null;
  length: number;
  participants_json: string;
  severity: string;
}

export interface DuplicationCluster {
  id: string;
  token_count: number;
  line_count: number;
  fragment_count: number;
  fingerprint: string;
  fragments_json: string;
}

export interface ArchitecturalViolation {
  id: string;
  rule_name: string;
  source_module_id: string | null;
  target_module_id: string | null;
  source_layer: string | null;
  target_layer: string | null;
  severity: string;
  message: string;
}

export type MetricsTab =
  | 'summary'
  | 'deadCode'
  | 'duplication'
  | 'architecture'
  | 'complexity'
  | 'typeSafety'
  | 'trends';

export interface SnapshotSummary {
  id: string;
  package_id: string;
  created_at: string;
  duration_ms: number | null;
}

interface MetricsBundleResponse {
  snapshotId?: string | null;
  snapshot?: SnapshotSummary | null;
  metrics?: EntityMetric[];
  cycles?: DependencyCycle[];
  duplications?: DuplicationCluster[];
  violations?: ArchitecturalViolation[];
}

export interface MetricDelta {
  key: string;
  entityId: string;
  entityType: string;
  current: number;
  baseline: number;
  delta: number;
  deltaPct: number;
}

interface MetricsStore {
  snapshotId: Ref<string | null>;
  snapshot: Ref<SnapshotSummary | null>;
  metrics: Ref<EntityMetric[]>;
  cycles: Ref<DependencyCycle[]>;
  duplications: Ref<DuplicationCluster[]>;
  violations: Ref<ArchitecturalViolation[]>;
  loading: Ref<boolean>;
  activeTab: Ref<MetricsTab>;
  dashboardOpen: Ref<boolean>;
  baselineSnapshotId: Ref<string | null>;
  baselineSnapshot: Ref<SnapshotSummary | null>;
  baselineMetrics: Ref<EntityMetric[]>;
  baselineLoading: Ref<boolean>;
  baselineError: Ref<string | null>;
  metricsByCategory: ComputedRef<Map<string, EntityMetric[]>>;
  deadCodeModuleIds: ComputedRef<Set<string>>;
  worstOffenderModules: ComputedRef<{ module_id: string; totalIssues: number }[]>;
  metricDeltas: ComputedRef<MetricDelta[]>;
  fetchMetricsBundle: () => Promise<void>;
  setBaselineById: (id: string) => Promise<void>;
  clearBaseline: () => void;
  setActiveTab: (tab: MetricsTab) => void;
  toggleDashboard: () => void;
  openDashboard: () => void;
  closeDashboard: () => void;
}

const METRIC_DELTAS_LIMIT = 50;

function readSnapshotSummary(data: MetricsBundleResponse): SnapshotSummary | null {
  if (data.snapshot && typeof data.snapshot === 'object') {
    const snap = data.snapshot;
    if (typeof snap.id === 'string' && typeof snap.package_id === 'string' && typeof snap.created_at === 'string') {
      return {
        id: snap.id,
        package_id: snap.package_id,
        created_at: snap.created_at,
        duration_ms: typeof snap.duration_ms === 'number' ? snap.duration_ms : null,
      };
    }
  }
  return null;
}

function resolveSnapshotId(data: MetricsBundleResponse, summary: SnapshotSummary | null): string | null {
  if (summary) return summary.id;
  if (typeof data.snapshotId === 'string' && data.snapshotId.length > 0) {
    return data.snapshotId;
  }
  return null;
}

const createMetricsStore = (): MetricsStore => {
  const snapshotId = ref<string | null>(null);
  const snapshot = ref<SnapshotSummary | null>(null);
  const metrics = ref<EntityMetric[]>([]);
  const cycles = ref<DependencyCycle[]>([]);
  const duplications = ref<DuplicationCluster[]>([]);
  const violations = ref<ArchitecturalViolation[]>([]);
  const loading = ref(false);
  const activeTab = ref<MetricsTab>('summary');
  const dashboardOpen = ref(false);
  const baselineSnapshotId = ref<string | null>(null);
  const baselineSnapshot = ref<SnapshotSummary | null>(null);
  const baselineMetrics = ref<EntityMetric[]>([]);
  const baselineLoading = ref(false);
  const baselineError = ref<string | null>(null);

  const metricsByCategory = computed<Map<string, EntityMetric[]>>(() => {
    const map = new Map<string, EntityMetric[]>();
    for (const metric of metrics.value) {
      const category = metric.metric_category || 'uncategorized';
      let arr = map.get(category);
      if (!arr) {
        arr = [];
        map.set(category, arr);
      }
      arr.push(metric);
    }
    return map;
  });

  const deadCodeModuleIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const metric of metrics.value) {
      if (
        metric.metric_category === 'deadCode' &&
        metric.metric_key === 'isDead' &&
        metric.metric_value === 1 &&
        metric.module_id
      ) {
        set.add(metric.module_id);
      }
    }
    return set;
  });

  const worstOffenderModules = computed<{ module_id: string; totalIssues: number }[]>(() => {
    const counts = new Map<string, number>();

    for (const metric of metrics.value) {
      if (!metric.module_id) continue;
      if (metric.metric_category !== 'issues' && metric.metric_category !== 'findings') continue;
      counts.set(metric.module_id, (counts.get(metric.module_id) ?? 0) + metric.metric_value);
    }

    for (const violation of violations.value) {
      if (!violation.source_module_id) continue;
      counts.set(violation.source_module_id, (counts.get(violation.source_module_id) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([module_id, totalIssues]) => ({ module_id: module_id, totalIssues: totalIssues }))
      .sort((a, b) => b.totalIssues - a.totalIssues)
      .slice(0, 20);
  });

  const metricDeltas = computed<MetricDelta[]>(() => {
    if (baselineMetrics.value.length === 0 || metrics.value.length === 0) {
      return [];
    }

    const baselineIndex = new Map<string, EntityMetric>();
    for (const metric of baselineMetrics.value) {
      const entityId = metric.entity_id ?? '';
      const key = `${metric.metric_key}::${metric.entity_type}::${entityId}`;
      baselineIndex.set(key, metric);
    }

    const seen = new Set<string>();
    const deltas: MetricDelta[] = [];

    for (const metric of metrics.value) {
      const entityId = metric.entity_id ?? '';
      const key = `${metric.metric_key}::${metric.entity_type}::${entityId}`;
      seen.add(key);
      const baseline = baselineIndex.get(key);
      const baselineValue = baseline?.metric_value ?? 0;
      const currentValue = metric.metric_value;
      const delta = currentValue - baselineValue;
      if (delta === 0) continue;
      const deltaPct = baselineValue === 0 ? (currentValue === 0 ? 0 : Infinity) : (delta / baselineValue) * 100;
      deltas.push({
        key: metric.metric_key,
        entityId: entityId,
        entityType: metric.entity_type,
        current: currentValue,
        baseline: baselineValue,
        delta: delta,
        deltaPct: deltaPct,
      });
    }

    // Include metrics that exist in baseline but not in current (removed entities).
    for (const metric of baselineMetrics.value) {
      const entityId = metric.entity_id ?? '';
      const key = `${metric.metric_key}::${metric.entity_type}::${entityId}`;
      if (seen.has(key)) continue;
      const baselineValue = metric.metric_value;
      if (baselineValue === 0) continue;
      const delta = -baselineValue;
      deltas.push({
        key: metric.metric_key,
        entityId: entityId,
        entityType: metric.entity_type,
        current: 0,
        baseline: baselineValue,
        delta: delta,
        deltaPct: -100,
      });
    }

    deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return deltas.slice(0, METRIC_DELTAS_LIMIT);
  });

  async function fetchMetricsBundle(): Promise<void> {
    loading.value = true;
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/metrics/latest`);
      if (!response.ok) {
        snapshotId.value = null;
        snapshot.value = null;
        metrics.value = [];
        cycles.value = [];
        duplications.value = [];
        violations.value = [];
        return;
      }
      const data = (await response.json()) as MetricsBundleResponse;
      const summary = readSnapshotSummary(data);
      snapshot.value = summary;
      snapshotId.value = resolveSnapshotId(data, summary);
      metrics.value = Array.isArray(data.metrics) ? data.metrics : [];
      cycles.value = Array.isArray(data.cycles) ? data.cycles : [];
      duplications.value = Array.isArray(data.duplications) ? data.duplications : [];
      violations.value = Array.isArray(data.violations) ? data.violations : [];
    } catch (err) {
      // Endpoint may not exist yet — degrade silently.
      // eslint-disable-next-line no-console
      console.warn('[metricsStore] Failed to fetch /metrics/latest', err);
      snapshotId.value = null;
      snapshot.value = null;
      metrics.value = [];
      cycles.value = [];
      duplications.value = [];
      violations.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function setBaselineById(id: string): Promise<void> {
    const trimmed = id.trim();
    if (!trimmed) {
      clearBaseline();
      return;
    }
    baselineLoading.value = true;
    baselineError.value = null;
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/metrics/snapshot/${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        baselineSnapshotId.value = null;
        baselineSnapshot.value = null;
        baselineMetrics.value = [];
        baselineError.value = response.status === 404 ? 'Snapshot not found' : `Request failed (${response.status.toString()})`;
        return;
      }
      const data = (await response.json()) as MetricsBundleResponse;
      const summary = readSnapshotSummary(data);
      baselineSnapshot.value = summary;
      baselineSnapshotId.value = summary?.id ?? trimmed;
      baselineMetrics.value = Array.isArray(data.metrics) ? data.metrics : [];
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[metricsStore] Failed to fetch baseline snapshot', err);
      baselineSnapshotId.value = null;
      baselineSnapshot.value = null;
      baselineMetrics.value = [];
      baselineError.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      baselineLoading.value = false;
    }
  }

  function clearBaseline(): void {
    baselineSnapshotId.value = null;
    baselineSnapshot.value = null;
    baselineMetrics.value = [];
    baselineError.value = null;
  }

  function setActiveTab(tab: MetricsTab): void {
    activeTab.value = tab;
  }

  function toggleDashboard(): void {
    dashboardOpen.value = !dashboardOpen.value;
  }

  function openDashboard(): void {
    dashboardOpen.value = true;
  }

  function closeDashboard(): void {
    dashboardOpen.value = false;
  }

  return {
    snapshotId: snapshotId,
    snapshot: snapshot,
    metrics: metrics,
    cycles: cycles,
    duplications: duplications,
    violations: violations,
    loading: loading,
    activeTab: activeTab,
    dashboardOpen: dashboardOpen,
    baselineSnapshotId: baselineSnapshotId,
    baselineSnapshot: baselineSnapshot,
    baselineMetrics: baselineMetrics,
    baselineLoading: baselineLoading,
    baselineError: baselineError,
    metricsByCategory: metricsByCategory,
    deadCodeModuleIds: deadCodeModuleIds,
    worstOffenderModules: worstOffenderModules,
    metricDeltas: metricDeltas,
    fetchMetricsBundle: fetchMetricsBundle,
    setBaselineById: setBaselineById,
    clearBaseline: clearBaseline,
    setActiveTab: setActiveTab,
    toggleDashboard: toggleDashboard,
    openDashboard: openDashboard,
    closeDashboard: closeDashboard,
  };
};

export const useMetricsStore: SetupStoreDefinition<'metrics', MetricsStore> = defineStore('metrics', createMetricsStore);
