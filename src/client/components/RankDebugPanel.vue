<script setup lang="ts">
import type { DependencyNode } from '../types/DependencyNode';
import type { LayoutRankTrace } from '../../shared/types/graph/LayoutRankTrace';

interface RankDebugPanelProps {
  selectedNode?: DependencyNode | null;
}

const props = withDefaults(defineProps<RankDebugPanelProps>(), {
  selectedNode: null,
});

function getTrace(node: DependencyNode): LayoutRankTrace | undefined {
  return node.data?.layoutRankTrace as LayoutRankTrace | undefined;
}

function fmt(n: number): string {
  return n.toFixed(2);
}
</script>

<template>
  <div class="rank-panel-shell bg-background-paper rounded-lg border border-border-default shadow-xl">
    <details class="rank-details" open>
      <summary class="section-header-static rank-summary">
        <span class="section-label">Rank Debug</span>
        <span v-if="selectedNode" class="rank-summary-badge">
          {{ fmt(selectedNode.data?.layoutWeight ?? 0) }}
        </span>
      </summary>

      <div class="section-content">
        <!-- No node selected -->
        <p v-if="!selectedNode" class="rank-empty">Select a node to inspect its layout rank.</p>

        <!-- Node selected but no trace (folder / symbol node) -->
        <template v-else-if="!getTrace(selectedNode)">
          <div class="rank-node-label">{{ selectedNode.data?.label ?? selectedNode.id }}</div>
          <p class="rank-empty">No rank trace (folder or symbol node).</p>
        </template>

        <!-- Full trace -->
        <template v-else>
          <div class="rank-node-label">{{ selectedNode.data?.label ?? selectedNode.id }}</div>

          <dl class="rank-values">
            <div class="rank-value-row">
              <dt>weight</dt>
              <dd>{{ fmt(getTrace(selectedNode)!.layoutWeight) }}</dd>
            </div>
            <div class="rank-value-row">
              <dt>depth</dt>
              <dd>{{ fmt(getTrace(selectedNode)!.weightedDepth) }}</dd>
            </div>
            <div class="rank-value-row">
              <dt>layer</dt>
              <dd>{{ selectedNode.data?.layerIndex ?? '—' }}</dd>
            </div>
            <div class="rank-value-row">
              <dt>sort</dt>
              <dd>{{ selectedNode.data?.sortOrder != null ? fmt(selectedNode.data.sortOrder as number) : '—' }}</dd>
            </div>
          </dl>

          <!-- Leaf node -->
          <p v-if="getTrace(selectedNode)!.contributions.length === 0" class="rank-empty rank-leaf">
            Leaf node — no imports. Base rank = 0.
          </p>

          <!-- Contributions -->
          <template v-else>
            <div class="rank-section-label">Import Contributions</div>
            <ul class="rank-contributions">
              <li
                v-for="c in getTrace(selectedNode)!.contributions"
                :key="c.importedId"
                class="rank-contribution"
                :class="{ 'rank-contribution-winner': c.isWinner }"
              >
                <div class="rank-contrib-header">
                  <span class="rank-winner-mark" aria-label="winning path">{{ c.isWinner ? '✓' : ' ' }}</span>
                  <span class="rank-contrib-label" :title="c.importedLabel">{{ c.importedLabel }}</span>
                  <span class="rank-contrib-fanin" :title="`${c.fanIn} modules import this target`">×{{ c.fanIn }}</span>
                </div>
                <div class="rank-contrib-math">
                  <span class="rank-term rank-term-step" :title="`stepCost = 1 + log₂(max(1, ${c.fanIn})) = ${fmt(c.stepCost)}`">
                    step {{ fmt(c.stepCost) }}
                  </span>
                  <span class="rank-plus">+</span>
                  <span class="rank-term rank-term-depth" :title="`weighted depth of ${c.importedLabel}`">
                    depth {{ fmt(c.depth) }}
                  </span>
                  <span class="rank-equals">=</span>
                  <span class="rank-term rank-term-total" :class="{ 'rank-term-total-winner': c.isWinner }">
                    {{ fmt(c.total) }}
                  </span>
                </div>
              </li>
            </ul>
          </template>
        </template>
      </div>
    </details>
  </div>
</template>

<style scoped>
.rank-panel-shell {
  width: min(20rem, calc(100vw - 1.5rem));
  padding: 0.68rem 0.68rem 0.92rem;
}

.rank-details {
  width: 100%;
}

.rank-summary {
  cursor: pointer;
  list-style: none;
  justify-content: space-between;
  width: 100%;
}

.rank-summary::-webkit-details-marker { display: none; }
.rank-summary::marker { display: none; }

.rank-summary::after {
  content: '▸';
  font-size: 0.6rem;
  opacity: 0.7;
  transition: transform 120ms ease-out;
  margin-left: auto;
}

.rank-details[open] .rank-summary::after {
  transform: rotate(90deg);
}

.rank-summary:focus-visible {
  outline: 2px solid var(--graph-selection-connected-border);
  outline-offset: 2px;
}

.rank-summary-badge {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.64rem;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.9);
  margin-right: 0.3rem;
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

.rank-empty {
  font-size: 0.65rem;
  color: rgba(148, 163, 184, 0.85);
  margin: 0;
}

.rank-leaf {
  margin-top: 0.4rem;
}

.rank-node-label {
  font-size: 0.72rem;
  color: rgba(203, 213, 225, 0.98);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 0.45rem;
}

.rank-values {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.28rem;
  margin: 0 0 0.5rem;
}

.rank-value-row {
  margin: 0;
  border-radius: 0.3rem;
  border: 1px solid rgba(100, 116, 139, 0.3);
  background: rgba(15, 23, 42, 0.6);
  padding: 0.18rem 0.28rem;
  display: flex;
  flex-direction: column;
  gap: 0.04rem;
}

.rank-value-row dt {
  font-size: 0.58rem;
  color: rgba(148, 163, 184, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.rank-value-row dd {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.72rem;
  color: rgba(226, 232, 240, 0.98);
  font-weight: 650;
  line-height: 1.15;
}

.rank-section-label {
  font-size: 0.6rem;
  color: rgba(148, 163, 184, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0.28rem;
}

.rank-contributions {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.rank-contribution {
  border-radius: 0.3rem;
  border: 1px solid rgba(100, 116, 139, 0.2);
  background: rgba(15, 23, 42, 0.45);
  padding: 0.22rem 0.32rem;
}

.rank-contribution-winner {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.06);
}

.rank-contrib-header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.15rem;
}

.rank-winner-mark {
  font-size: 0.6rem;
  color: rgba(34, 197, 94, 0.9);
  font-weight: 700;
  width: 0.7rem;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}

.rank-contrib-label {
  font-size: 0.66rem;
  color: rgba(203, 213, 225, 0.96);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.rank-contrib-fanin {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.58rem;
  color: rgba(148, 163, 184, 0.75);
  flex-shrink: 0;
}

.rank-contrib-math {
  display: flex;
  align-items: baseline;
  gap: 0.25rem;
  padding-left: 1rem;
}

.rank-term {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.62rem;
}

.rank-term-step {
  color: rgba(125, 211, 252, 0.85);
}

.rank-term-depth {
  color: rgba(196, 181, 253, 0.85);
}

.rank-term-total {
  color: rgba(148, 163, 184, 0.9);
}

.rank-term-total-winner {
  color: rgba(134, 239, 172, 0.95);
  font-weight: 700;
}

.rank-plus,
.rank-equals {
  font-size: 0.58rem;
  color: rgba(100, 116, 139, 0.8);
}
</style>
