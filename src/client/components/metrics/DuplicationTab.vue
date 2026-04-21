<script setup lang="ts">
import { computed, ref } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

interface ClusterFragment {
  module_id?: string;
  entity_id?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
}

const metricsStore = useMetricsStore();

const expanded = ref<Set<string>>(new Set());

const clusters = computed(() => metricsStore.duplications);

function parseFragments(raw: string): ClusterFragment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as ClusterFragment[];
    }
    return [];
  } catch {
    return [];
  }
}

function toggleCluster(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expanded.value = next;
}

function fragmentLabel(fragment: ClusterFragment): string {
  if (fragment.file_path) {
    const range =
      typeof fragment.start_line === 'number' && typeof fragment.end_line === 'number'
        ? `:${String(fragment.start_line)}-${String(fragment.end_line)}`
        : '';
    return `${fragment.file_path}${range}`;
  }
  if (fragment.module_id) {
    return fragment.module_id;
  }
  if (fragment.entity_id) {
    return fragment.entity_id;
  }
  return '(unknown location)';
}
</script>

<template>
  <div class="metrics-tab-content">
    <div v-if="clusters.length === 0" class="metrics-empty">
      No duplication detected yet. Run analysis to populate.
    </div>
    <ul v-else class="metrics-list">
      <li v-for="cluster in clusters" :key="cluster.id" class="metrics-cluster">
        <button type="button" class="metrics-cluster-header" @click="toggleCluster(cluster.id)">
          <span class="metrics-cluster-chevron">{{ expanded.has(cluster.id) ? '▼' : '▶' }}</span>
          <span class="metrics-cluster-title">
            <span class="metrics-cluster-count">{{ cluster.fragment_count }} fragments</span>
            <span class="metrics-cluster-meta">{{ cluster.token_count }} tokens</span>
            <span class="metrics-cluster-meta">{{ cluster.line_count }} lines</span>
          </span>
        </button>
        <ul v-if="expanded.has(cluster.id)" class="metrics-fragment-list">
          <li
            v-for="(fragment, index) in parseFragments(cluster.fragments_json)"
            :key="`${cluster.id}-${String(index)}`"
            class="metrics-fragment"
          >
            {{ fragmentLabel(fragment) }}
          </li>
        </ul>
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
  gap: 0.28rem;
}

.metrics-cluster {
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
}

.metrics-cluster-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.7rem;
  cursor: pointer;
  text-align: left;
}

.metrics-cluster-header:hover {
  background: rgba(255, 255, 255, 0.05);
}

.metrics-cluster-chevron {
  font-size: 0.55rem;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.metrics-cluster-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
}

.metrics-cluster-count {
  font-weight: 700;
  color: var(--graph-insight-warning-text);
}

.metrics-cluster-meta {
  color: var(--text-secondary);
}

.metrics-fragment-list {
  list-style: none;
  padding: 0.3rem 0.5rem 0.4rem 1.6rem;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  border-top: 1px solid var(--border-default);
  background: rgba(0, 0, 0, 0.15);
}

.metrics-fragment {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.62rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
