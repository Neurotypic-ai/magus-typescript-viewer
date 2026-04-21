<script setup lang="ts">
import { computed } from 'vue';

import { useMetricsStore } from '../../stores/metricsStore';

const metricsStore = useMetricsStore();

const cycles = computed(() => metricsStore.cycles);
const violations = computed(() => metricsStore.violations);

function parseParticipants(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        items.push(entry);
      } else if (entry !== null && typeof entry === 'object') {
        const obj = entry as { id?: unknown; module_id?: unknown; name?: unknown };
        if (typeof obj.id === 'string') items.push(obj.id);
        else if (typeof obj.module_id === 'string') items.push(obj.module_id);
        else if (typeof obj.name === 'string') items.push(obj.name);
      }
    }
    return items;
  } catch {
    return [];
  }
}
</script>

<template>
  <div class="metrics-tab-content">
    <section class="metrics-subsection">
      <div class="metrics-subsection-title">Dependency Cycles</div>
      <div v-if="cycles.length === 0" class="metrics-empty">No dependency cycles detected.</div>
      <ul v-else class="metrics-list">
        <li v-for="cycle in cycles" :key="cycle.id" class="metrics-cycle">
          <div class="metrics-cycle-header">
            <span :class="['metrics-cycle-severity', `metrics-cycle-severity--${cycle.severity}`]">
              {{ cycle.severity }}
            </span>
            <span class="metrics-cycle-length">length {{ cycle.length }}</span>
          </div>
          <div class="metrics-cycle-path">
            <span v-for="(participant, index) in parseParticipants(cycle.participants_json)" :key="`${cycle.id}-${String(index)}`">
              <span class="metrics-cycle-node">{{ participant }}</span>
              <span v-if="index < parseParticipants(cycle.participants_json).length - 1" class="metrics-cycle-arrow">→</span>
            </span>
          </div>
        </li>
      </ul>
    </section>

    <section class="metrics-subsection">
      <div class="metrics-subsection-title">Architectural Violations</div>
      <div v-if="violations.length === 0" class="metrics-empty">No architectural violations detected.</div>
      <ul v-else class="metrics-list">
        <li v-for="violation in violations" :key="violation.id" class="metrics-violation">
          <div class="metrics-violation-header">
            <span :class="['metrics-violation-severity', `metrics-violation-severity--${violation.severity}`]">
              {{ violation.severity }}
            </span>
            <span class="metrics-violation-rule">{{ violation.rule_name }}</span>
          </div>
          <div v-if="violation.source_layer || violation.target_layer" class="metrics-violation-layers">
            <span class="metrics-violation-layer">{{ violation.source_layer ?? '?' }}</span>
            <span class="metrics-violation-arrow">→</span>
            <span class="metrics-violation-layer">{{ violation.target_layer ?? '?' }}</span>
          </div>
          <div class="metrics-violation-message">{{ violation.message }}</div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.metrics-tab-content {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.metrics-subsection-title {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: 0.35rem;
}

.metrics-empty {
  padding: 0.6rem;
  font-size: 0.7rem;
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

.metrics-cycle,
.metrics-violation {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metrics-cycle-header,
.metrics-violation-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.68rem;
}

.metrics-cycle-severity,
.metrics-violation-severity {
  padding: 0.05rem 0.35rem;
  border-radius: 0.2rem;
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.metrics-cycle-severity--error,
.metrics-violation-severity--error,
.metrics-cycle-severity--critical,
.metrics-violation-severity--critical {
  background: var(--graph-insight-critical-bg);
  color: var(--graph-insight-critical-text);
}

.metrics-cycle-severity--warning,
.metrics-violation-severity--warning {
  background: var(--graph-insight-warning-bg);
  color: var(--graph-insight-warning-text);
}

.metrics-cycle-severity--info,
.metrics-violation-severity--info {
  background: var(--graph-insight-info-bg);
  color: var(--graph-insight-info-text);
}

.metrics-cycle-length {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.64rem;
}

.metrics-cycle-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.62rem;
  color: var(--text-primary);
  line-height: 1.5;
  word-break: break-all;
}

.metrics-cycle-node {
  padding: 0.05rem 0.2rem;
  border-radius: 0.18rem;
  background: rgba(255, 255, 255, 0.05);
}

.metrics-cycle-arrow {
  margin: 0 0.2rem;
  color: var(--text-secondary);
}

.metrics-violation-rule {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-primary);
  font-weight: 600;
}

.metrics-violation-layers {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.66rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-secondary);
}

.metrics-violation-layer {
  padding: 0.02rem 0.25rem;
  border-radius: 0.18rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.metrics-violation-arrow {
  color: var(--text-secondary);
}

.metrics-violation-message {
  font-size: 0.66rem;
  color: var(--text-primary);
  line-height: 1.35;
}
</style>
