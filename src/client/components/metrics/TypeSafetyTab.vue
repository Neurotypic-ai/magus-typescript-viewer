<script setup lang="ts">
import { computed, ref } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

interface TypeSafetyRow {
  module_id: string;
  anyCount: number;
  anyDensity: number;
}

type SortKey = 'anyCount' | 'anyDensity';

const metricsStore = useMetricsStore();

const sortKey = ref<SortKey>('anyDensity');

const rows = computed<TypeSafetyRow[]>(() => {
  const counts = new Map<string, number>();
  const densities = new Map<string, number>();

  for (const metric of metricsStore.metrics) {
    if (metric.metric_category !== 'typeSafety') continue;
    if (!metric.module_id) continue;

    if (metric.metric_key === 'typeSafety.anyCount' || metric.metric_key === 'anyCount') {
      counts.set(metric.module_id, (counts.get(metric.module_id) ?? 0) + metric.metric_value);
    } else if (metric.metric_key === 'typeSafety.anyDensity' || metric.metric_key === 'anyDensity') {
      densities.set(metric.module_id, metric.metric_value);
    }
  }

  const moduleIds = new Set<string>([...counts.keys(), ...densities.keys()]);
  const result: TypeSafetyRow[] = [];
  for (const moduleId of moduleIds) {
    result.push({
      module_id: moduleId,
      anyCount: counts.get(moduleId) ?? 0,
      anyDensity: densities.get(moduleId) ?? 0,
    });
  }
  return result;
});

const sortedRows = computed<TypeSafetyRow[]>(() => {
  const key = sortKey.value;
  return [...rows.value].sort((a, b) => b[key] - a[key]);
});

const totals = computed(() => {
  const all = rows.value;
  if (all.length === 0) {
    return { totalAny: 0, avgDensity: 0, moduleCount: 0, maxDensity: 0 };
  }
  let totalAny = 0;
  let sumDensity = 0;
  let maxDensity = 0;
  for (const row of all) {
    totalAny += row.anyCount;
    sumDensity += row.anyDensity;
    if (row.anyDensity > maxDensity) maxDensity = row.anyDensity;
  }
  return {
    totalAny: totalAny,
    avgDensity: sumDensity / all.length,
    moduleCount: all.length,
    maxDensity: maxDensity,
  };
});

function barWidth(density: number): string {
  const reference = totals.value.maxDensity > 0 ? totals.value.maxDensity : 1;
  // Normalize against the largest value so the visualization shows relative scale.
  const raw = density <= 1 ? density * 100 : density;
  const refRaw = reference <= 1 ? reference * 100 : reference;
  const pct = refRaw > 0 ? Math.min(100, (raw / refRaw) * 100) : 0;
  return `${pct.toFixed(1)}%`;
}

function formatDensity(density: number): string {
  // If density is stored as a ratio (0..1), show percent. Otherwise show raw.
  if (density <= 1) return `${(density * 100).toFixed(1)}%`;
  return density.toFixed(2);
}

function setSortKey(key: SortKey): void {
  sortKey.value = key;
}
</script>

<template>
  <div class="metrics-tab-content">
    <div class="metrics-kpi-grid">
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Modules</div>
        <div class="metrics-kpi-value">{{ totals.moduleCount }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Total any</div>
        <div class="metrics-kpi-value">{{ totals.totalAny }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Avg density</div>
        <div class="metrics-kpi-value">{{ formatDensity(totals.avgDensity) }}</div>
      </div>
    </div>

    <div class="metrics-sort-row">
      <span class="metrics-sort-label">Sort by:</span>
      <button
        type="button"
        :class="['metrics-sort-button', { 'metrics-sort-button--active': sortKey === 'anyDensity' }]"
        @click="setSortKey('anyDensity')"
      >
        Density
      </button>
      <button
        type="button"
        :class="['metrics-sort-button', { 'metrics-sort-button--active': sortKey === 'anyCount' }]"
        @click="setSortKey('anyCount')"
      >
        Count
      </button>
    </div>

    <div v-if="sortedRows.length === 0" class="metrics-empty">
      No type safety metrics available. Run analysis to populate.
    </div>
    <ul v-else class="metrics-list">
      <li v-for="row in sortedRows" :key="row.module_id" class="metrics-typesafety-row">
        <div class="metrics-typesafety-header">
          <span class="metrics-typesafety-id" :title="row.module_id">{{ row.module_id }}</span>
          <span class="metrics-typesafety-count">{{ row.anyCount }}</span>
        </div>
        <div class="metrics-typesafety-bar-track">
          <div class="metrics-typesafety-bar-fill" :style="{ width: barWidth(row.anyDensity) }"></div>
          <span class="metrics-typesafety-bar-label">{{ formatDensity(row.anyDensity) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.metrics-tab-content {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.metrics-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
  gap: 0.3rem;
}

.metrics-kpi-card {
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  padding: 0.35rem 0.4rem;
  background: rgba(255, 255, 255, 0.03);
}

.metrics-kpi-label {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 0.15rem;
}

.metrics-kpi-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}

.metrics-sort-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.65rem;
}

.metrics-sort-label {
  color: var(--text-secondary);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}

.metrics-sort-button {
  padding: 0.2rem 0.45rem;
  border: 1px solid var(--border-default);
  border-radius: 0.22rem;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 140ms ease-out, color 140ms ease-out;
}

.metrics-sort-button:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.metrics-sort-button--active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.metrics-empty {
  padding: 0.75rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
  text-align: center;
  border: 1px dashed var(--border-default);
  border-radius: 0.3rem;
}

.metrics-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metrics-typesafety-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.02);
}

.metrics-typesafety-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.metrics-typesafety-id {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metrics-typesafety-count {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--graph-insight-warning-text);
}

.metrics-typesafety-bar-track {
  position: relative;
  height: 0.9rem;
  border-radius: 0.2rem;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.metrics-typesafety-bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: var(--graph-insight-warning-text, #facc15);
  opacity: 0.55;
  transition: width 200ms ease-out;
}

.metrics-typesafety-bar-label {
  position: relative;
  display: block;
  padding: 0 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 0.9rem;
}
</style>
