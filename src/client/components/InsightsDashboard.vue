<script setup lang="ts">
import { computed, ref } from 'vue';

import { useInsightsStore } from '../stores/insightsStore';
import { exportInsightsJson, exportInsightsMarkdown } from '../utils/insightsExport';

import type { InsightCategory, InsightKind, InsightResult } from '../../shared/types/api/Insight';

const insightsStore = useInsightsStore();

const expanded = ref(false);

const report = computed(() => insightsStore.report);
const hasInsights = computed(() => report.value !== null && report.value.insights.length > 0);

const categoryLabels: Record<InsightCategory, string> = {
  'dependency-health': 'Dependency Health',
  'structural-complexity': 'Structural Complexity',
  'api-surface': 'API Surface',
  connectivity: 'Connectivity',
  maintenance: 'Maintenance',
};

const categoryOrder: InsightCategory[] = [
  'dependency-health',
  'structural-complexity',
  'api-surface',
  'connectivity',
  'maintenance',
];

interface GroupedInsight {
  category: InsightCategory;
  label: string;
  insights: InsightResult[];
}

const groupedInsights = computed<GroupedInsight[]>(() => {
  if (!report.value) return [];
  const map = new Map<InsightCategory, InsightResult[]>();
  for (const insight of report.value.insights) {
    let arr = map.get(insight.category);
    if (!arr) {
      arr = [];
      map.set(insight.category, arr);
    }
    arr.push(insight);
  }

  return categoryOrder
    .filter((cat) => map.has(cat))
    .map((cat) => ({
      category: cat,
      label: categoryLabels[cat],
      insights: map.get(cat) ?? [],
    }));
});

function handleFilterClick(kind: InsightKind): void {
  if (insightsStore.activeFilter === kind) {
    insightsStore.setActiveFilter(null);
  } else {
    insightsStore.setActiveFilter(kind);
  }
}

function handleExportJson(): void {
  if (!report.value) return;
  exportInsightsJson(report.value);
}

function handleExportMarkdown(): void {
  if (!report.value) return;
  exportInsightsMarkdown(report.value);
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'critical':
      return '!';
    case 'warning':
      return '~';
    default:
      return 'i';
  }
}
</script>

<template>
  <div v-if="hasInsights" class="insights-dashboard">
    <!-- Collapsed bar -->
    <button type="button" class="insights-summary-bar nodrag" @click="expanded = !expanded">
      <span class="insights-label">Insights</span>
      <span v-if="report" class="insights-counts">
        <span v-if="report.summary.critical > 0" class="insights-count insights-count--critical">{{
          report.summary.critical
        }}</span>
        <span v-if="report.summary.warning > 0" class="insights-count insights-count--warning">{{
          report.summary.warning
        }}</span>
        <span v-if="report.summary.info > 0" class="insights-count insights-count--info">{{
          report.summary.info
        }}</span>
      </span>
      <span v-if="report" class="insights-health">{{ report.healthScore }}/100</span>
      <span class="insights-chevron">{{ expanded ? '\u25BC' : '\u25B6' }}</span>
    </button>

    <!-- Expanded panel -->
    <div v-if="expanded" class="insights-panel">
      <div class="insights-panel-header">
        <span class="insights-panel-title">Health Score: {{ report?.healthScore ?? 0 }}/100</span>
        <div class="insights-panel-actions">
          <button type="button" class="insights-export-btn nodrag" title="Export as JSON" @click="handleExportJson">
            JSON
          </button>
          <button
            type="button"
            class="insights-export-btn nodrag"
            title="Export as Markdown"
            @click="handleExportMarkdown"
          >
            MD
          </button>
        </div>
      </div>

      <div v-for="group in groupedInsights" :key="group.category" class="insights-group">
        <div class="insights-group-title">{{ group.label }}</div>
        <div v-for="insight in group.insights" :key="insight.type" class="insights-item">
          <button
            type="button"
            :class="[
              'insights-item-btn',
              'nodrag',
              { 'insights-item-btn--active': insightsStore.activeFilter === insight.type },
            ]"
            @click="handleFilterClick(insight.type)"
          >
            <span :class="['insights-severity', `insights-severity--${insight.severity}`]">{{
              severityIcon(insight.severity)
            }}</span>
            <span class="insights-item-title">{{ insight.title }}</span>
            <span class="insights-item-count">{{ insight.entities.length }}</span>
          </button>
        </div>
      </div>

      <button
        v-if="insightsStore.activeFilter"
        type="button"
        class="insights-clear-filter nodrag"
        @click="insightsStore.setActiveFilter(null)"
      >
        Clear filter
      </button>
    </div>
  </div>
</template>

<style scoped>
.insights-dashboard {
  background: var(--background-node);
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  font-size: 0.72rem;
  min-width: 200px;
  max-width: 320px;
  overflow: hidden;
}

.insights-summary-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 600;
}

.insights-summary-bar:hover {
  background: rgba(255, 255, 255, 0.05);
}

.insights-label {
  flex-shrink: 0;
}

.insights-counts {
  display: flex;
  gap: 0.2rem;
  flex: 1;
}

.insights-count {
  padding: 0.05rem 0.25rem;
  border-radius: 0.2rem;
  font-size: 0.6rem;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.insights-count--critical {
  background: var(--graph-insight-critical-bg);
  color: var(--graph-insight-critical-text);
}

.insights-count--warning {
  background: var(--graph-insight-warning-bg);
  color: var(--graph-insight-warning-text);
}

.insights-count--info {
  background: var(--graph-insight-info-bg);
  color: var(--graph-insight-info-text);
}

.insights-health {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-secondary);
  font-size: 0.65rem;
}

.insights-chevron {
  font-size: 0.55rem;
  color: var(--text-secondary);
}

.insights-panel {
  border-top: 1px solid var(--border-default);
  padding: 0.45rem;
  max-height: 400px;
  overflow-y: auto;
}

.insights-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;
}

.insights-panel-title {
  font-weight: 700;
  color: var(--text-primary);
}

.insights-panel-actions {
  display: flex;
  gap: 0.25rem;
}

.insights-export-btn {
  padding: 0.15rem 0.35rem;
  border: 1px solid var(--border-default);
  border-radius: 0.2rem;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: 0.6rem;
  font-weight: 700;
  cursor: pointer;
}

.insights-export-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.insights-group {
  margin-bottom: 0.35rem;
}

.insights-group-title {
  padding: 0.2rem 0;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.insights-item-btn {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  width: 100%;
  padding: 0.25rem 0.35rem;
  border: none;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.68rem;
  cursor: pointer;
  text-align: left;
}

.insights-item-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.insights-item-btn--active {
  background: var(--graph-insight-info-bg);
  outline: 1px solid var(--graph-selection-connected-outline);
}

.insights-severity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: 0.15rem;
  font-size: 0.55rem;
  font-weight: 700;
  flex-shrink: 0;
}

.insights-severity--critical {
  background: var(--graph-insight-critical-bg);
  color: var(--graph-insight-critical-text);
}

.insights-severity--warning {
  background: var(--graph-insight-warning-bg);
  color: var(--graph-insight-warning-text);
}

.insights-severity--info {
  background: var(--graph-insight-info-bg);
  color: var(--graph-insight-info-text);
}

.insights-item-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.insights-item-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.62rem;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.insights-clear-filter {
  width: 100%;
  padding: 0.3rem;
  margin-top: 0.3rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: 0.65rem;
  cursor: pointer;
}

.insights-clear-filter:hover {
  background: rgba(255, 255, 255, 0.08);
}
</style>
