<script setup lang="ts">
import { computed } from 'vue';

import { useMetricsStore } from '../stores/metricsStore';
import ArchitectureTab from './metrics/ArchitectureTab.vue';
import ComplexityTab from './metrics/ComplexityTab.vue';
import DeadCodeTab from './metrics/DeadCodeTab.vue';
import DuplicationTab from './metrics/DuplicationTab.vue';
import MetricsSummaryTab from './metrics/MetricsSummaryTab.vue';
import TrendsTab from './metrics/TrendsTab.vue';
import TypeSafetyTab from './metrics/TypeSafetyTab.vue';

import type { MetricsTab } from '../stores/metricsStore';

interface TabDef {
  key: MetricsTab;
  label: string;
}

const metricsStore = useMetricsStore();

const tabs: TabDef[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'deadCode', label: 'Dead Code' },
  { key: 'duplication', label: 'Duplication' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'typeSafety', label: 'Type Safety' },
  { key: 'architecture', label: 'Architecture' },
  { key: 'trends', label: 'Trends' },
];

const hasData = computed(
  () =>
    metricsStore.metrics.length > 0 ||
    metricsStore.cycles.length > 0 ||
    metricsStore.duplications.length > 0 ||
    metricsStore.violations.length > 0
);

function handleTabClick(tab: MetricsTab): void {
  metricsStore.setActiveTab(tab);
}

function handleClose(): void {
  metricsStore.closeDashboard();
}
</script>

<template>
  <div class="metrics-dashboard bg-background-paper rounded-lg border border-border-default shadow-xl">
    <div class="metrics-dashboard-header">
      <span class="metrics-dashboard-title">Metrics Dashboard</span>
      <button
        type="button"
        class="metrics-dashboard-close nodrag"
        aria-label="Close metrics dashboard"
        @click="handleClose"
      >
        &times;
      </button>
    </div>

    <div class="metrics-dashboard-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="metricsStore.activeTab === tab.key"
        :class="[
          'metrics-dashboard-tab',
          'nodrag',
          { 'metrics-dashboard-tab--active': metricsStore.activeTab === tab.key },
        ]"
        @click="handleTabClick(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="metrics-dashboard-body">
      <div v-if="metricsStore.loading" class="metrics-dashboard-loading">Loading metrics&hellip;</div>
      <div v-else-if="!hasData && metricsStore.activeTab !== 'trends'" class="metrics-dashboard-empty">
        No metrics yet. Run <code>pnpm analyze .</code> to populate.
      </div>
      <template v-else>
        <MetricsSummaryTab v-if="metricsStore.activeTab === 'summary'" />
        <DeadCodeTab v-else-if="metricsStore.activeTab === 'deadCode'" />
        <DuplicationTab v-else-if="metricsStore.activeTab === 'duplication'" />
        <ComplexityTab v-else-if="metricsStore.activeTab === 'complexity'" />
        <TypeSafetyTab v-else-if="metricsStore.activeTab === 'typeSafety'" />
        <ArchitectureTab v-else-if="metricsStore.activeTab === 'architecture'" />
        <TrendsTab v-else-if="metricsStore.activeTab === 'trends'" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.metrics-dashboard {
  width: min(22rem, calc(100vw - 1.5rem));
  max-height: calc(100vh - 1.5rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.metrics-dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.metrics-dashboard-title {
  font-size: 0.84rem;
  font-weight: 650;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.metrics-dashboard-close {
  border: 1px solid var(--border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border-radius: 0.25rem;
  padding: 0.1rem 0.45rem;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}

.metrics-dashboard-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.metrics-dashboard-tabs {
  display: flex;
  gap: 0.2rem;
  padding: 0.4rem 0.5rem 0;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.metrics-dashboard-tab {
  padding: 0.3rem 0.55rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 0.3rem 0.3rem 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 140ms ease-out, color 140ms ease-out;
}

.metrics-dashboard-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.metrics-dashboard-tab--active {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.metrics-dashboard-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.6rem 0.7rem 0.8rem;
}

.metrics-dashboard-loading,
.metrics-dashboard-empty {
  padding: 1rem 0.75rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.metrics-dashboard-empty code {
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
}
</style>
