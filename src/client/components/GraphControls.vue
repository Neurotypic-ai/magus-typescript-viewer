<script setup lang="ts">
import { computed } from 'vue';

import { Panel } from '@vue-flow/core';

import { DEFAULT_RELATIONSHIP_TYPES, useGraphSettings } from '../stores/graphSettings';
import GraphSearch from './GraphSearch.vue';
import InsightsDashboard from './InsightsDashboard.vue';

import type { Ref } from 'vue';

interface GraphSearchContext {
  searchQuery: Ref<string>;
  runSearch: () => void;
  clearSearch?: () => void;
}

interface FpsStats {
  min: number;
  max: number;
  avg: number;
  p90: number;
  sampleCount: number;
}

interface TypeCount {
  type: string;
  count: number;
}

interface GraphControlsProps {
  relationshipAvailability?: Record<string, { available: boolean; reason?: string }>;
  graphSearchContext?: GraphSearchContext | null;
  fps?: number;
  fpsStats?: FpsStats;
  fpsChartPoints?: string;
  fpsTargetLineY?: string;
  fpsChartWidth?: number;
  fpsChartHeight?: number;
  renderedNodeCount?: number;
  renderedEdgeCount?: number;
  renderedNodeTypeCounts?: TypeCount[];
  renderedEdgeTypeCounts?: TypeCount[];
}

const props = withDefaults(defineProps<GraphControlsProps>(), {
  relationshipAvailability: () => ({}),
  graphSearchContext: null,
  fps: 0,
  fpsStats: () => ({ min: 0, max: 0, avg: 0, p90: 0, sampleCount: 0 }),
  fpsChartPoints: '',
  fpsTargetLineY: '0',
  fpsChartWidth: 120,
  fpsChartHeight: 40,
  renderedNodeCount: 0,
  renderedEdgeCount: 0,
  renderedNodeTypeCounts: () => [],
  renderedEdgeTypeCounts: () => [],
});

const emit = defineEmits<{
  'relationship-filter-change': [types: string[]];
  'toggle-hide-test-files': [value: boolean];
  'toggle-orphan-global': [value: boolean];
  'toggle-show-fps': [value: boolean];
  'toggle-fps-advanced': [value: boolean];
}>();

const graphSettings = useGraphSettings();

const relationshipTypes = [...DEFAULT_RELATIONSHIP_TYPES];

const getRelationshipAvailability = (type: string) => props.relationshipAvailability[type] ?? { available: true };
const isRelationshipDisabled = (type: string) => !getRelationshipAvailability(type).available;
const relationshipReason = (type: string) => getRelationshipAvailability(type).reason ?? 'Unavailable';
const relationshipReasonId = (type: string): string =>
  `relationship-reason-${type.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;

const toggleListItem = (values: string[], value: string, enabled: boolean): string[] =>
  enabled ? (values.includes(value) ? values : [...values, value]) : values.filter((x) => x !== value);

const handleRelationshipFilterChange = (type: string, checked: boolean) => {
  if (isRelationshipDisabled(type)) return;
  emit('relationship-filter-change', toggleListItem(graphSettings.enabledRelationshipTypes, type, checked));
};

const handleHideTestFilesToggle = (checked: boolean) => {
  emit('toggle-hide-test-files', checked);
};
const handleOrphanGlobalToggle = (checked: boolean) => {
  emit('toggle-orphan-global', checked);
};
const handleShowFpsToggle = (checked: boolean) => {
  emit('toggle-show-fps', checked);
};
const handleFpsAdvancedToggle = (checked: boolean) => {
  emit('toggle-fps-advanced', checked);
};

const searchQueryModel = computed({
  get: () => props.graphSearchContext?.searchQuery.value ?? '',
  set: (value: string) => {
    const searchQuery = props.graphSearchContext?.searchQuery;
    if (searchQuery) {
      searchQuery.value = value;
    }
  },
});
</script>

<template>
  <Panel v-if="graphSearchContext" position="top-left" class="graph-search-panel">
    <div class="graph-search-shell bg-background-paper rounded-lg border border-border-default shadow-xl">
      <GraphSearch
        v-model="searchQueryModel"
        :run-search="graphSearchContext.runSearch"
      />
    </div>
  </Panel>
  <Panel
    position="top-left"
    class="graph-controls-panel"
    :class="{ 'graph-controls-panel-with-search': !!graphSearchContext }"
  >
    <div
      class="graph-controls-shell bg-background-paper rounded-lg border border-border-default shadow-xl"
      :class="{ 'graph-controls-shell-with-search': !!graphSearchContext }"
    >
      <div class="section">
        <div class="section-header-static">
          <span class="section-label">Analysis</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Analysis options</legend>
            <div class="control-group">
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.hideTestFiles"
                  @change="(e) => handleHideTestFilesToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Hide test files</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.highlightOrphanGlobal"
                  @change="(e) => handleOrphanGlobalToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Highlight global orphans</span>
              </label>
            </div>
          </fieldset>
        </div>
      </div>

      <div class="section section-divider">
        <div class="section-header-static">
          <span class="section-label">Relationship Types</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Relationship visibility filters</legend>
            <div class="control-group">
              <div v-for="type in relationshipTypes" :key="type" class="space-y-1">
                <label
                  class="control-row"
                  :class="isRelationshipDisabled(type) ? 'control-row-disabled' : 'control-row-interactive'"
                >
                  <input
                    type="checkbox"
                    class="control-checkbox"
                    :checked="graphSettings.enabledRelationshipTypes.includes(type)"
                    :disabled="isRelationshipDisabled(type)"
                    :aria-disabled="isRelationshipDisabled(type)"
                    :aria-describedby="isRelationshipDisabled(type) ? relationshipReasonId(type) : undefined"
                    @change="(e) => handleRelationshipFilterChange(type, (e.target as HTMLInputElement).checked)"
                  />
                  <span class="control-label capitalize">{{ type }}</span>
                </label>
                <p v-if="isRelationshipDisabled(type)" :id="relationshipReasonId(type)" class="section-helper ml-6">
                  {{ relationshipReason(type) }}
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      </div>

      <div class="section section-divider">
        <div class="section-header-static">
          <span class="section-label">Performance</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Performance options</legend>
            <div class="control-group">
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showFps"
                  @change="(e) => handleShowFpsToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show FPS</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showFpsAdvanced"
                  @change="(e) => handleFpsAdvancedToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Advanced</span>
              </label>
            </div>
          </fieldset>

          <div v-if="graphSettings.showFps" class="fps-display">
            <div
              class="fps-counter"
              :class="{ 'fps-low': fps < 30, 'fps-ok': fps >= 30 && fps < 55, 'fps-good': fps >= 55 }"
            >
              {{ fps }} <span class="fps-label">FPS</span>
            </div>
            <template v-if="graphSettings.showFpsAdvanced && fpsStats">
              <div class="fps-stats-grid">
                <div class="fps-stat-card">
                  <span class="fps-stat-label">Min</span>
                  <span class="fps-stat-value">{{ fpsStats.min }}</span>
                </div>
                <div class="fps-stat-card">
                  <span class="fps-stat-label">Max</span>
                  <span class="fps-stat-value">{{ fpsStats.max }}</span>
                </div>
                <div class="fps-stat-card">
                  <span class="fps-stat-label">Avg</span>
                  <span class="fps-stat-value">{{ fpsStats.avg.toFixed(1) }}</span>
                </div>
                <div class="fps-stat-card">
                  <span class="fps-stat-label">P90</span>
                  <span class="fps-stat-value">{{ fpsStats.p90 }}</span>
                </div>
              </div>
              <div class="fps-chart-wrapper">
                <svg
                  class="fps-chart"
                  :viewBox="`0 0 ${fpsChartWidth} ${fpsChartHeight}`"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Real-time FPS trend"
                >
                  <line x1="0" :y1="fpsTargetLineY" :x2="fpsChartWidth" :y2="fpsTargetLineY" class="fps-chart-target" />
                  <polyline v-if="fpsChartPoints" :points="fpsChartPoints" class="fps-chart-line" />
                </svg>
                <div class="fps-chart-caption">Last {{ fpsStats.sampleCount }} samples</div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="section section-divider">
        <details class="stats-details">
          <summary class="section-header-static stats-summary">
            <span class="section-label">Graph Stats</span>
            <span class="stats-summary-metrics">{{ renderedNodeCount }}n · {{ renderedEdgeCount }}e</span>
          </summary>
          <div class="section-content">
            <dl class="stats-overview">
              <div class="stats-overview-row">
                <dt>Nodes</dt>
                <dd>{{ renderedNodeCount }}</dd>
              </div>
              <div class="stats-overview-row">
                <dt>Edges</dt>
                <dd>{{ renderedEdgeCount }}</dd>
              </div>
            </dl>
            <div class="stats-section">
              <div class="stats-section-label">Node Types</div>
              <ul class="stats-list">
                <li v-for="entry in renderedNodeTypeCounts" :key="`n-${entry.type}`" class="stats-list-row">
                  <span class="stats-type">{{ entry.type }}</span>
                  <span class="stats-count">{{ entry.count }}</span>
                </li>
              </ul>
            </div>
            <div class="stats-section">
              <div class="stats-section-label">Edge Types</div>
              <ul v-if="renderedEdgeTypeCounts.length > 0" class="stats-list">
                <li v-for="entry in renderedEdgeTypeCounts" :key="`e-${entry.type}`" class="stats-list-row">
                  <span class="stats-type">{{ entry.type }}</span>
                  <span class="stats-count">{{ entry.count }}</span>
                </li>
              </ul>
              <div v-else class="stats-empty">No visible edges</div>
            </div>
          </div>
        </details>
      </div>

      <div class="section section-divider insights-section">
        <div class="section-header-static">
          <span class="section-label">Insights</span>
        </div>
        <InsightsDashboard class="insights-embedded" />
      </div>

      <div class="section section-divider">
        <div class="section-header-static">
          <span class="section-label">Debug</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Debug rendering options</legend>
            <div class="control-group">
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showDebugNodeIds"
                  @change="(e) => graphSettings.setShowDebugNodeIds((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show node IDs</span>
              </label>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.graph-search-shell {
  width: min(20rem, calc(100vw - 1.5rem));
  padding: 0.42rem 0.5rem;
}

.graph-controls-panel-with-search {
  margin-top: 3.85rem;
}

.graph-controls-shell {
  width: min(20rem, calc(100vw - 1.5rem));
  max-height: calc(100vh - 1.5rem);
  padding: 0.68rem 0.68rem 0.92rem;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
}

.graph-controls-shell-with-search {
  max-height: calc(100vh - 5.35rem);
}

.graph-controls-shell::-webkit-scrollbar {
  width: 0.5rem;
}

.graph-controls-shell::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
}

.graph-controls-shell::-webkit-scrollbar-track {
  background: transparent;
}

.section {
  margin: 0;
}

.section-divider {
  margin-top: 0.62rem;
  padding-top: 0.62rem;
  border-top: 1px solid rgba(var(--border-default-rgb, 64, 64, 64), 0.7);
}

.section-header-static {
  display: flex;
  align-items: center;
  min-height: 1.8rem;
  padding: 0.28rem 0.34rem;
}

.section-label {
  font-size: 0.84rem;
  font-weight: 650;
  color: var(--color-text-primary, currentColor);
  letter-spacing: 0.01em;
}

.section-content {
  padding: 0.3rem 0.34rem 0.14rem;
}

.section-helper {
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-secondary);
}

.control-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.34rem;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.5rem;
  font-size: 0.75rem;
  line-height: 1.25;
  color: var(--color-text-secondary);
  transition: color 150ms ease-out;
}

.control-row-interactive {
  cursor: pointer;
}

.control-row-interactive:hover {
  color: var(--color-text-primary);
}

.control-row-disabled {
  cursor: not-allowed;
  color: var(--color-text-muted);
}

.control-label {
  font-size: 0.75rem;
  line-height: 1.3;
}

.control-checkbox {
  width: 1rem;
  height: 1rem;
  min-width: 1rem;
  min-height: 1rem;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--color-primary-main);
}

.control-checkbox:disabled {
  cursor: not-allowed;
}

.control-checkbox:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── FPS display ── */

.fps-display {
  margin-top: 0.5rem;
}

.fps-counter {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 1rem;
  font-weight: 700;
  padding: 0.3rem 0.7rem;
  border-radius: 0.4rem;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.25);
  letter-spacing: 0.05em;
  text-align: center;
}

.fps-label {
  font-size: 0.75rem;
  opacity: 0.6;
  font-weight: 500;
}

.fps-good { color: var(--graph-fps-good); }
.fps-ok   { color: var(--graph-fps-ok); }
.fps-low  { color: var(--graph-fps-low); }

.fps-stats-grid {
  margin-top: 0.35rem;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.28rem;
}

.fps-stat-card {
  border-radius: 0.3rem;
  border: 1px solid rgba(100, 116, 139, 0.35);
  background: rgba(15, 23, 42, 0.7);
  padding: 0.18rem 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.04rem;
}

.fps-stat-label {
  color: rgba(148, 163, 184, 0.95);
  font-size: 0.58rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.fps-stat-value {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  color: rgba(226, 232, 240, 0.98);
  font-size: 0.74rem;
  font-weight: 650;
  line-height: 1.15;
}

.fps-chart-wrapper {
  margin-top: 0.35rem;
}

.fps-chart {
  width: 100%;
  height: 3rem;
  border-radius: 0.35rem;
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: linear-gradient(to top, rgba(34, 211, 238, 0.07), rgba(34, 211, 238, 0.01)), rgba(15, 23, 42, 0.8);
}

.fps-chart-target {
  stroke: rgba(244, 63, 94, 0.5);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.fps-chart-line {
  fill: none;
  stroke: var(--graph-fps-line);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.fps-chart-caption {
  margin-top: 0.18rem;
  text-align: right;
  font-size: 0.6rem;
  color: rgba(148, 163, 184, 0.85);
}

/* ── Graph stats ── */

.stats-details {
  width: 100%;
}

.stats-summary {
  cursor: pointer;
  list-style: none;
  justify-content: space-between;
  width: 100%;
}

.stats-summary::-webkit-details-marker { display: none; }
.stats-summary::marker { display: none; }

.stats-summary::after {
  content: '▸';
  font-size: 0.6rem;
  opacity: 0.7;
  transition: transform 120ms ease-out;
  margin-left: auto;
}

.stats-details[open] .stats-summary::after {
  transform: rotate(90deg);
}

.stats-summary:focus-visible {
  outline: 2px solid var(--graph-selection-connected-border);
  outline-offset: 2px;
}

.stats-summary-metrics {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  color: rgba(148, 163, 184, 0.9);
  font-size: 0.64rem;
  font-weight: 600;
  margin-right: 0.25rem;
}

.stats-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.28rem;
  margin: 0 0 0.5rem;
}

.stats-overview-row {
  margin: 0;
  border-radius: 0.3rem;
  border: 1px solid rgba(100, 116, 139, 0.3);
  background: rgba(15, 23, 42, 0.6);
  padding: 0.18rem 0.35rem;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.stats-overview-row dt {
  font-size: 0.6rem;
  color: rgba(148, 163, 184, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.stats-overview-row dd {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.72rem;
  color: rgba(226, 232, 240, 0.98);
}

.stats-section {
  margin-top: 0.45rem;
}

.stats-section-label {
  font-size: 0.6rem;
  color: rgba(148, 163, 184, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0.2rem;
}

.stats-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.stats-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.68rem;
}

.stats-type {
  color: rgba(203, 213, 225, 0.96);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-count {
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  color: rgba(148, 163, 184, 0.96);
}

.stats-empty {
  font-size: 0.65rem;
  color: rgba(148, 163, 184, 0.85);
}

/* ── Insights section ── */

.insights-section {
  padding-bottom: 0.2rem;
}

.insights-embedded :deep(.insights-dashboard) {
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  padding: 0;
}

.insights-embedded :deep(.insights-panel) {
  max-height: min(8rem, 30vh);
}
</style>
