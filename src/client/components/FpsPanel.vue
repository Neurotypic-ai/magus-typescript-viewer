<script setup lang="ts">
import { useGraphSettings } from '../stores/graphSettings';

interface FpsStats {
  min: number;
  max: number;
  avg: number;
  p90: number;
  sampleCount: number;
}

interface FpsPanelProps {
  fps?: number;
  fpsStats?: FpsStats;
  fpsChartPoints?: string;
  fpsTargetLineY?: string;
  fpsChartWidth?: number;
  fpsChartHeight?: number;
}

const props = withDefaults(defineProps<FpsPanelProps>(), {
  fps: 0,
  fpsStats: () => ({ min: 0, max: 0, avg: 0, p90: 0, sampleCount: 0 }),
  fpsChartPoints: '',
  fpsTargetLineY: '0',
  fpsChartWidth: 120,
  fpsChartHeight: 40,
});

const graphSettings = useGraphSettings();
</script>

<template>
  <div class="fps-panel-shell bg-background-paper rounded-lg border border-border-default shadow-xl">
    <div class="section">
      <div class="section-header-static">
        <span class="section-label">Performance</span>
      </div>
      <div class="section-content">
        <div class="fps-display">
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
  </div>
</template>

<style scoped>
.fps-panel-shell {
  width: min(20rem, calc(100vw - 1.5rem));
  padding: 0.68rem 0.68rem 0.92rem;
}

.section {
  margin: 0;
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
</style>
