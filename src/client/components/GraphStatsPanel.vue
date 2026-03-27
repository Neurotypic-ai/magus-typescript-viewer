<script setup lang="ts">
interface TypeCount {
  type: string;
  count: number;
}

interface GraphStatsPanelProps {
  renderedNodeCount?: number;
  renderedEdgeCount?: number;
  renderedNodeTypeCounts?: TypeCount[];
  renderedEdgeTypeCounts?: TypeCount[];
}

withDefaults(defineProps<GraphStatsPanelProps>(), {
  renderedNodeCount: 0,
  renderedEdgeCount: 0,
  renderedNodeTypeCounts: () => [],
  renderedEdgeTypeCounts: () => [],
});
</script>

<template>
  <div class="stats-panel-shell bg-background-paper rounded-lg border border-border-default shadow-xl">
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
</template>

<style scoped>
.stats-panel-shell {
  width: min(20rem, calc(100vw - 1.5rem));
  padding: 0.68rem 0.68rem 0.92rem;
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
</style>
