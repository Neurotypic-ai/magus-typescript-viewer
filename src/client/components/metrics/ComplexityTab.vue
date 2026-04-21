<script setup lang="ts">
import { computed } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

import type { EntityMetric } from '../../stores/metricsStore';

const COMPLEXITY_THRESHOLD = 15;
const TOP_N = 30;
const TRUNCATE_LENGTH = 12;

const metricsStore = useMetricsStore();

const complexityMetrics = computed<EntityMetric[]>(() => {
  const rows: EntityMetric[] = [];
  for (const metric of metricsStore.metrics) {
    if (metric.metric_category !== 'complexity') continue;
    if (metric.metric_key !== 'complexity.cyclomatic') continue;
    rows.push(metric);
  }
  return rows;
});

const topMetrics = computed<EntityMetric[]>(() =>
  [...complexityMetrics.value].sort((a, b) => b.metric_value - a.metric_value).slice(0, TOP_N)
);

const stats = computed(() => {
  const all = complexityMetrics.value;
  if (all.length === 0) {
    return { mean: 0, max: 0, count: 0, overThreshold: 0 };
  }
  let sum = 0;
  let max = 0;
  let overThreshold = 0;
  for (const metric of all) {
    sum += metric.metric_value;
    if (metric.metric_value > max) max = metric.metric_value;
    if (metric.metric_value > COMPLEXITY_THRESHOLD) overThreshold += 1;
  }
  return {
    mean: sum / all.length,
    max: max,
    count: all.length,
    overThreshold: overThreshold,
  };
});

function severityClass(value: number): string {
  if (value <= 10) return 'metrics-complexity-row--green';
  if (value <= 20) return 'metrics-complexity-row--yellow';
  return 'metrics-complexity-row--red';
}

function truncateId(id: string | null): string {
  if (!id) return '(none)';
  if (id.length <= TRUNCATE_LENGTH) return id;
  return `${id.slice(0, TRUNCATE_LENGTH)}…`;
}

function truncateModuleId(id: string | null): string {
  if (!id) return '';
  if (id.length <= TRUNCATE_LENGTH) return id;
  return `${id.slice(0, TRUNCATE_LENGTH)}…`;
}
</script>

<template>
  <div class="metrics-tab-content">
    <div class="metrics-kpi-grid">
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Methods</div>
        <div class="metrics-kpi-value">{{ stats.count }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Mean</div>
        <div class="metrics-kpi-value">{{ stats.mean.toFixed(1) }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Max</div>
        <div class="metrics-kpi-value">{{ stats.max }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">&gt; {{ COMPLEXITY_THRESHOLD }}</div>
        <div class="metrics-kpi-value">{{ stats.overThreshold }}</div>
      </div>
    </div>

    <div v-if="topMetrics.length === 0" class="metrics-empty">
      No complexity metrics available. Run analysis to populate.
    </div>
    <ul v-else class="metrics-list">
      <li
        v-for="metric in topMetrics"
        :key="metric.id"
        :class="['metrics-complexity-row', severityClass(metric.metric_value)]"
      >
        <span class="metrics-complexity-value">{{ metric.metric_value }}</span>
        <span class="metrics-complexity-type">{{ metric.entity_type }}</span>
        <span class="metrics-complexity-id" :title="metric.entity_id ?? ''">
          {{ truncateId(metric.entity_id) }}
        </span>
        <span v-if="metric.module_id" class="metrics-complexity-module" :title="metric.module_id">
          {{ truncateModuleId(metric.module_id) }}
        </span>
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
  grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr));
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
  gap: 0.15rem;
}

.metrics-complexity-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0.4rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.02);
  font-size: 0.66rem;
}

.metrics-complexity-row--green {
  border-left: 3px solid var(--graph-insight-info-text, #4ade80);
}

.metrics-complexity-row--yellow {
  border-left: 3px solid var(--graph-insight-warning-text, #facc15);
}

.metrics-complexity-row--red {
  border-left: 3px solid var(--graph-insight-critical-text, #f87171);
}

.metrics-complexity-value {
  flex-shrink: 0;
  width: 2.2rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-primary);
  text-align: right;
}

.metrics-complexity-type {
  flex-shrink: 0;
  padding: 0.02rem 0.25rem;
  border-radius: 0.18rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6rem;
}

.metrics-complexity-id {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.62rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metrics-complexity-module {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 30%;
}
</style>
