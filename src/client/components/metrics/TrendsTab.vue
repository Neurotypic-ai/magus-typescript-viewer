<script setup lang="ts">
import { computed, ref } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

import type { MetricDelta } from '../../stores/metricsStore';

const TRUNCATE_LENGTH = 12;
const DELTA_DISPLAY_LIMIT = 20;
const HIGHER_IS_WORSE_CATEGORIES = ['complexity', 'coupling', 'typeSafety', 'deadCode', 'duplication'];
const DOC_COVERAGE_KEYS = ['documentation.docCoverage'];

const metricsStore = useMetricsStore();

const baselineIdInput = ref('');

const hasBaseline = computed(() => metricsStore.baselineSnapshot !== null || metricsStore.baselineMetrics.length > 0);

const summary = computed(() => {
  const currentCount = metricsStore.metrics.length;
  const baselineCount = metricsStore.baselineMetrics.length;
  const currentFindings = metricsStore.metrics.reduce((total, metric) => {
    if (metric.metric_category === 'issues' || metric.metric_category === 'findings') {
      return total + metric.metric_value;
    }
    return total;
  }, 0);
  const baselineFindings = metricsStore.baselineMetrics.reduce((total, metric) => {
    if (metric.metric_category === 'issues' || metric.metric_category === 'findings') {
      return total + metric.metric_value;
    }
    return total;
  }, 0);
  return {
    currentCount: currentCount,
    baselineCount: baselineCount,
    currentFindings: currentFindings,
    baselineFindings: baselineFindings,
    metricsDelta: currentCount - baselineCount,
    findingsDelta: currentFindings - baselineFindings,
  };
});

const topDeltas = computed<MetricDelta[]>(() => metricsStore.metricDeltas.slice(0, DELTA_DISPLAY_LIMIT));

function truncateId(id: string): string {
  if (!id) return '(none)';
  if (id.length <= TRUNCATE_LENGTH) return id;
  return `${id.slice(0, TRUNCATE_LENGTH)}…`;
}

function isHigherWorse(metricKey: string): boolean {
  if (DOC_COVERAGE_KEYS.includes(metricKey)) return false;
  for (const category of HIGHER_IS_WORSE_CATEGORIES) {
    if (metricKey === category) return true;
    if (metricKey.startsWith(`${category}.`)) return true;
  }
  return true;
}

function deltaDirectionClass(delta: MetricDelta): string {
  if (delta.delta === 0) return 'metrics-trend-delta--flat';
  const higherWorse = isHigherWorse(delta.key);
  const increased = delta.delta > 0;
  const isBad = higherWorse ? increased : !increased;
  return isBad ? 'metrics-trend-delta--bad' : 'metrics-trend-delta--good';
}

function deltaArrow(delta: MetricDelta): string {
  if (delta.delta === 0) return '-';
  return delta.delta > 0 ? '↑' : '↓';
}

function formatDelta(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatDeltaPct(pct: number): string {
  if (!Number.isFinite(pct)) return 'new';
  const abs = Math.abs(pct);
  if (abs >= 1000) return `${(pct / 1000).toFixed(1)}k%`;
  if (abs >= 100) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

async function applyBaseline(): Promise<void> {
  const value = baselineIdInput.value.trim();
  if (!value) return;
  await metricsStore.setBaselineById(value);
}

function handleClearBaseline(): void {
  baselineIdInput.value = '';
  metricsStore.clearBaseline();
}
</script>

<template>
  <div class="metrics-tab-content">
    <div class="metrics-trend-baseline-setup">
      <div class="metrics-trend-baseline-label">Baseline snapshot</div>
      <div class="metrics-trend-baseline-row">
        <input
          v-model="baselineIdInput"
          type="text"
          class="metrics-trend-baseline-input"
          placeholder="Enter snapshot UUID"
          :disabled="metricsStore.baselineLoading"
          @keyup.enter="applyBaseline"
        />
        <button
          type="button"
          class="metrics-trend-baseline-button"
          :disabled="metricsStore.baselineLoading || baselineIdInput.trim().length === 0"
          @click="applyBaseline"
        >
          {{ metricsStore.baselineLoading ? 'Loading…' : 'Load' }}
        </button>
        <button
          v-if="hasBaseline"
          type="button"
          class="metrics-trend-baseline-button metrics-trend-baseline-button--ghost"
          @click="handleClearBaseline"
        >
          Clear
        </button>
      </div>
      <div v-if="metricsStore.baselineError" class="metrics-trend-baseline-error">
        {{ metricsStore.baselineError }}
      </div>
    </div>

    <div v-if="!hasBaseline" class="metrics-empty">
      No baseline selected. Paste a snapshot UUID above, or configure one in Settings.
    </div>

    <template v-else>
      <div class="metrics-trend-snapshots">
        <div class="metrics-trend-snapshot-card metrics-trend-snapshot-card--current">
          <div class="metrics-trend-snapshot-label">Current</div>
          <div class="metrics-trend-snapshot-id" :title="metricsStore.snapshot?.id ?? metricsStore.snapshotId ?? ''">
            {{ metricsStore.snapshot?.id ?? metricsStore.snapshotId ?? '—' }}
          </div>
          <div class="metrics-trend-snapshot-time">
            {{ formatTimestamp(metricsStore.snapshot?.created_at) }}
          </div>
        </div>
        <div class="metrics-trend-snapshot-card metrics-trend-snapshot-card--baseline">
          <div class="metrics-trend-snapshot-label">Baseline</div>
          <div
            class="metrics-trend-snapshot-id"
            :title="metricsStore.baselineSnapshot?.id ?? metricsStore.baselineSnapshotId ?? ''"
          >
            {{ metricsStore.baselineSnapshot?.id ?? metricsStore.baselineSnapshotId ?? '—' }}
          </div>
          <div class="metrics-trend-snapshot-time">
            {{ formatTimestamp(metricsStore.baselineSnapshot?.created_at) }}
          </div>
        </div>
      </div>

      <div class="metrics-trend-kpi-grid">
        <div class="metrics-trend-kpi-card">
          <div class="metrics-trend-kpi-label">Metrics</div>
          <div class="metrics-trend-kpi-row">
            <span class="metrics-trend-kpi-value">{{ summary.currentCount }}</span>
            <span class="metrics-trend-kpi-baseline">/ {{ summary.baselineCount }}</span>
          </div>
          <div :class="['metrics-trend-kpi-delta', summary.metricsDelta === 0 ? '' : summary.metricsDelta > 0 ? 'metrics-trend-delta--bad' : 'metrics-trend-delta--good']">
            {{ summary.metricsDelta >= 0 ? '+' : '' }}{{ summary.metricsDelta }}
          </div>
        </div>
        <div class="metrics-trend-kpi-card">
          <div class="metrics-trend-kpi-label">Findings</div>
          <div class="metrics-trend-kpi-row">
            <span class="metrics-trend-kpi-value">{{ summary.currentFindings }}</span>
            <span class="metrics-trend-kpi-baseline">/ {{ summary.baselineFindings }}</span>
          </div>
          <div :class="['metrics-trend-kpi-delta', summary.findingsDelta === 0 ? '' : summary.findingsDelta > 0 ? 'metrics-trend-delta--bad' : 'metrics-trend-delta--good']">
            {{ summary.findingsDelta >= 0 ? '+' : '' }}{{ summary.findingsDelta }}
          </div>
        </div>
      </div>

      <div class="metrics-section">
        <div class="metrics-section-title">Top {{ DELTA_DISPLAY_LIMIT }} metric deltas</div>
        <div v-if="topDeltas.length === 0" class="metrics-empty">
          No metric changes detected between the selected snapshots.
        </div>
        <table v-else class="metrics-trend-table">
          <thead>
            <tr>
              <th class="metrics-trend-th metrics-trend-th--dir">Dir</th>
              <th class="metrics-trend-th">Metric</th>
              <th class="metrics-trend-th">Entity</th>
              <th class="metrics-trend-th metrics-trend-th--num">Current</th>
              <th class="metrics-trend-th metrics-trend-th--num">Baseline</th>
              <th class="metrics-trend-th metrics-trend-th--num">Δ</th>
              <th class="metrics-trend-th metrics-trend-th--num">Δ %</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(delta, index) in topDeltas" :key="`${delta.key}-${delta.entityId}-${index.toString()}`">
              <td :class="['metrics-trend-td metrics-trend-td--dir', deltaDirectionClass(delta)]">
                {{ deltaArrow(delta) }}
              </td>
              <td class="metrics-trend-td metrics-trend-td--key" :title="delta.key">{{ delta.key }}</td>
              <td class="metrics-trend-td" :title="delta.entityId">
                <span class="metrics-trend-td-type">{{ delta.entityType }}</span>
                <span class="metrics-trend-td-id">{{ truncateId(delta.entityId) }}</span>
              </td>
              <td class="metrics-trend-td metrics-trend-td--num">{{ formatDelta(delta.current) }}</td>
              <td class="metrics-trend-td metrics-trend-td--num">{{ formatDelta(delta.baseline) }}</td>
              <td :class="['metrics-trend-td metrics-trend-td--num', deltaDirectionClass(delta)]">
                {{ delta.delta > 0 ? '+' : '' }}{{ formatDelta(delta.delta) }}
              </td>
              <td :class="['metrics-trend-td metrics-trend-td--num', deltaDirectionClass(delta)]">
                {{ formatDeltaPct(delta.deltaPct) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.metrics-tab-content {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.metrics-trend-baseline-setup {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  background: rgba(255, 255, 255, 0.02);
}

.metrics-trend-baseline-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
}

.metrics-trend-baseline-row {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}

.metrics-trend-baseline-input {
  flex: 1;
  padding: 0.22rem 0.4rem;
  border: 1px solid var(--border-default);
  border-radius: 0.22rem;
  background: rgba(0, 0, 0, 0.25);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
}

.metrics-trend-baseline-input:focus {
  outline: 1px solid var(--graph-insight-info-text, #4ade80);
  outline-offset: -1px;
}

.metrics-trend-baseline-button {
  padding: 0.22rem 0.55rem;
  border: 1px solid var(--border-default);
  border-radius: 0.22rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 140ms ease-out;
}

.metrics-trend-baseline-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.metrics-trend-baseline-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.metrics-trend-baseline-button--ghost {
  background: transparent;
  color: var(--text-secondary);
}

.metrics-trend-baseline-error {
  font-size: 0.62rem;
  color: var(--graph-insight-critical-text, #f87171);
}

.metrics-trend-snapshots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
}

.metrics-trend-snapshot-card {
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  padding: 0.4rem 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.metrics-trend-snapshot-card--current {
  border-left: 3px solid var(--graph-insight-info-text, #4ade80);
}

.metrics-trend-snapshot-card--baseline {
  border-left: 3px solid var(--text-secondary);
}

.metrics-trend-snapshot-label {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
}

.metrics-trend-snapshot-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metrics-trend-snapshot-time {
  font-size: 0.6rem;
  color: var(--text-secondary);
}

.metrics-trend-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.35rem;
}

.metrics-trend-kpi-card {
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  padding: 0.4rem 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.metrics-trend-kpi-label {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
}

.metrics-trend-kpi-row {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
}

.metrics-trend-kpi-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.metrics-trend-kpi-baseline {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.metrics-trend-kpi-delta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.metrics-trend-delta--good {
  color: var(--graph-insight-info-text, #4ade80);
}

.metrics-trend-delta--bad {
  color: var(--graph-insight-critical-text, #f87171);
}

.metrics-trend-delta--flat {
  color: var(--text-secondary);
}

.metrics-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.metrics-section-title {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.metrics-empty {
  padding: 0.7rem;
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-align: center;
  border: 1px dashed var(--border-default);
  border-radius: 0.3rem;
}

.metrics-trend-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.62rem;
}

.metrics-trend-th {
  text-align: left;
  padding: 0.25rem 0.3rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  font-size: 0.55rem;
  border-bottom: 1px solid var(--border-default);
  background: rgba(255, 255, 255, 0.03);
}

.metrics-trend-th--num {
  text-align: right;
}

.metrics-trend-th--dir {
  width: 1.2rem;
  text-align: center;
}

.metrics-trend-td {
  padding: 0.22rem 0.3rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  vertical-align: top;
}

.metrics-trend-td--num {
  text-align: right;
  white-space: nowrap;
}

.metrics-trend-td--dir {
  text-align: center;
  font-weight: 700;
}

.metrics-trend-td--key {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metrics-trend-td-type {
  display: inline-block;
  padding: 0.02rem 0.25rem;
  margin-right: 0.25rem;
  border-radius: 0.18rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  font-size: 0.55rem;
}

.metrics-trend-td-id {
  font-size: 0.6rem;
  color: var(--text-primary);
}
</style>
