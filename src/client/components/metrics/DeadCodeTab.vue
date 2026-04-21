<script setup lang="ts">
import { computed } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

interface DeadModuleRow {
  module_id: string;
  unusedExports: number;
}

const metricsStore = useMetricsStore();

const deadModules = computed<DeadModuleRow[]>(() => {
  const rows: DeadModuleRow[] = [];
  const unusedByModule = new Map<string, number>();

  for (const metric of metricsStore.metrics) {
    if (metric.metric_category !== 'deadCode') continue;
    if (metric.metric_key !== 'unusedExports') continue;
    if (!metric.module_id) continue;
    unusedByModule.set(metric.module_id, (unusedByModule.get(metric.module_id) ?? 0) + metric.metric_value);
  }

  for (const moduleId of metricsStore.deadCodeModuleIds) {
    rows.push({
      module_id: moduleId,
      unusedExports: unusedByModule.get(moduleId) ?? 0,
    });
  }

  // Also include modules with unused exports but not yet marked dead.
  for (const [moduleId, unusedCount] of unusedByModule) {
    if (metricsStore.deadCodeModuleIds.has(moduleId)) continue;
    rows.push({ module_id: moduleId, unusedExports: unusedCount });
  }

  return rows.sort((a, b) => b.unusedExports - a.unusedExports);
});
</script>

<template>
  <div class="metrics-tab-content">
    <div v-if="deadModules.length === 0" class="metrics-empty">
      No dead code detected yet. Run analysis to populate.
    </div>
    <ul v-else class="metrics-list">
      <li v-for="row in deadModules" :key="row.module_id" class="metrics-dead-row">
        <span class="metrics-dead-id" :title="row.module_id">{{ row.module_id }}</span>
        <span class="metrics-dead-count">{{ row.unusedExports }} unused</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.metrics-tab-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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
  gap: 0.2rem;
}

.metrics-dead-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.28rem 0.4rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.02);
}

.metrics-dead-id {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.68rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metrics-dead-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--graph-insight-info-text);
  flex-shrink: 0;
}
</style>
