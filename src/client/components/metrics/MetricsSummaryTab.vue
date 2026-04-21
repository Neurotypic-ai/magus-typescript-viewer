<script setup lang="ts">
import { computed } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

const metricsStore = useMetricsStore();

const totalMetrics = computed(() => metricsStore.metrics.length);

const totalFindings = computed(() => {
  let total = 0;
  for (const metric of metricsStore.metrics) {
    if (metric.metric_category === 'issues' || metric.metric_category === 'findings') {
      total += metric.metric_value;
    }
  }
  return total;
});

const cycleCount = computed(() => metricsStore.cycles.length);
const duplicationCount = computed(() => metricsStore.duplications.length);
const violationCount = computed(() => metricsStore.violations.length);

const topOffenders = computed(() => metricsStore.worstOffenderModules.slice(0, 10));
</script>

<template>
  <div class="metrics-tab-content">
    <div class="metrics-kpi-grid">
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Metrics</div>
        <div class="metrics-kpi-value">{{ totalMetrics }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Findings</div>
        <div class="metrics-kpi-value">{{ totalFindings }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Cycles</div>
        <div class="metrics-kpi-value">{{ cycleCount }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Duplications</div>
        <div class="metrics-kpi-value">{{ duplicationCount }}</div>
      </div>
      <div class="metrics-kpi-card">
        <div class="metrics-kpi-label">Violations</div>
        <div class="metrics-kpi-value">{{ violationCount }}</div>
      </div>
    </div>

    <div class="metrics-section">
      <div class="metrics-section-title">Top 10 Worst Offenders</div>
      <div v-if="topOffenders.length === 0" class="metrics-empty">No offender modules to report.</div>
      <ol v-else class="metrics-offender-list">
        <li v-for="entry in topOffenders" :key="entry.module_id" class="metrics-offender-item">
          <span class="metrics-offender-id" :title="entry.module_id">{{ entry.module_id }}</span>
          <span class="metrics-offender-count">{{ entry.totalIssues }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.metrics-tab-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.metrics-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.4rem;
}

.metrics-kpi-card {
  border: 1px solid var(--border-default);
  border-radius: 0.35rem;
  padding: 0.5rem 0.6rem;
  background: rgba(255, 255, 255, 0.03);
}

.metrics-kpi-label {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 0.2rem;
}

.metrics-kpi-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.metrics-section-title {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: 0.35rem;
}

.metrics-offender-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.metrics-offender-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.22rem 0.4rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  font-size: 0.7rem;
  background: rgba(255, 255, 255, 0.02);
}

.metrics-offender-id {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metrics-offender-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--graph-insight-warning-text);
  flex-shrink: 0;
}

.metrics-empty {
  padding: 0.5rem;
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-align: center;
  border: 1px dashed var(--border-default);
  border-radius: 0.25rem;
}
</style>
