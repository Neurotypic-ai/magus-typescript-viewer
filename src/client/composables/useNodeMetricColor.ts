import { computed } from 'vue';

import { useMetricsStore } from '../stores/metricsStore';
import { anyDensityToColor, complexityToColor, couplingToColor } from '../theme/heatmap';

import type { ComputedRef, Ref } from 'vue';

import type { OverlayMode } from '../stores/graphSettings';
import type { EntityMetric } from '../stores/metricsStore';

/**
 * Resolve a background-color string for a given node based on the active
 * overlay mode and the latest metrics bundle. Returns `undefined` when the
 * overlay is disabled or when no metric data is available for the node so
 * that callers can cleanly fall back to the default theme color.
 *
 * The node id passed in is the graph node id, which for modules matches the
 * `module_id` on metrics and for symbols matches `entity_id`. Both lookups
 * are considered so the overlay works across levels of the graph.
 */
export function useNodeMetricColor(nodeId: Ref<string>, mode: Ref<OverlayMode>): ComputedRef<string | undefined> {
  const metricsStore = useMetricsStore();

  return computed<string | undefined>(() => {
    const currentMode = mode.value;
    if (currentMode === 'none') return undefined;

    const id = nodeId.value;
    if (!id) return undefined;

    const metrics = metricsStore.metrics;
    if (metrics.length === 0) return undefined;

    switch (currentMode) {
      case 'complexity': {
        const max = maxComplexityForNode(metrics, id);
        return max === null ? undefined : complexityToColor(max);
      }
      case 'coupling': {
        const coupling = couplingForNode(metrics, id);
        return coupling === null ? undefined : couplingToColor(coupling.afferent, coupling.efferent);
      }
      case 'typeSafety': {
        const density = anyDensityForNode(metrics, id);
        return density === null ? undefined : anyDensityToColor(density);
      }
    }
  });
}

function metricMatchesNode(metric: EntityMetric, id: string): boolean {
  return metric.module_id === id || metric.entity_id === id;
}

function maxComplexityForNode(metrics: readonly EntityMetric[], id: string): number | null {
  let best: number | null = null;
  for (const metric of metrics) {
    if (metric.metric_category !== 'complexity') continue;
    if (metric.metric_key !== 'complexity.cyclomatic') continue;
    if (!metricMatchesNode(metric, id)) continue;
    if (!Number.isFinite(metric.metric_value)) continue;
    if (best === null || metric.metric_value > best) {
      best = metric.metric_value;
    }
  }
  return best;
}

function couplingForNode(
  metrics: readonly EntityMetric[],
  id: string
): { afferent: number; efferent: number } | null {
  let afferent: number | null = null;
  let efferent: number | null = null;
  for (const metric of metrics) {
    if (metric.metric_category !== 'coupling') continue;
    if (!metricMatchesNode(metric, id)) continue;
    if (!Number.isFinite(metric.metric_value)) continue;
    if (metric.metric_key === 'coupling.afferent' || metric.metric_key === 'afferent') {
      afferent = (afferent ?? 0) + metric.metric_value;
    } else if (metric.metric_key === 'coupling.efferent' || metric.metric_key === 'efferent') {
      efferent = (efferent ?? 0) + metric.metric_value;
    }
  }
  if (afferent === null && efferent === null) return null;
  return { afferent: afferent ?? 0, efferent: efferent ?? 0 };
}

function anyDensityForNode(metrics: readonly EntityMetric[], id: string): number | null {
  for (const metric of metrics) {
    if (metric.metric_category !== 'typeSafety') continue;
    if (!metricMatchesNode(metric, id)) continue;
    if (metric.metric_key !== 'typeSafety.anyDensity' && metric.metric_key !== 'anyDensity') continue;
    if (!Number.isFinite(metric.metric_value)) continue;
    return metric.metric_value;
  }
  return null;
}
