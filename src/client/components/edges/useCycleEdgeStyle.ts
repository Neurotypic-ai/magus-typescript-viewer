import { computed } from 'vue';

import { useGraphSettings } from '../../stores/graphSettings';
import { useMetricsStore } from '../../stores/metricsStore';

import type { ComputedRef, Ref } from 'vue';

import type { DependencyCycle } from '../../stores/metricsStore';

interface CycleEdgeStyleResult {
  style: ComputedRef<Record<string, string | number> | undefined>;
}

/**
 * Derive an edge `style` object that reflects the current cycle-highlight
 * setting. When cycle highlighting is enabled, edges that participate in a
 * dependency cycle are rendered with a thicker red stroke; all other edges
 * fade to 40% opacity so the cycle stands out. The composable preserves any
 * inbound `style` prop (including per-hover stroke variables) by merging it
 * with the cycle treatment rather than replacing it.
 */
export function useCycleEdgeStyle(
  source: Ref<string>,
  target: Ref<string>,
  inboundStyle: Ref<Record<string, string | number> | undefined>
): CycleEdgeStyleResult {
  const metricsStore = useMetricsStore();
  const graphSettings = useGraphSettings();

  const cycleModuleIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const cycle of metricsStore.cycles) {
      for (const participant of parseParticipants(cycle)) {
        set.add(participant);
      }
    }
    return set;
  });

  const style = computed<Record<string, string | number> | undefined>(() => {
    const base = inboundStyle.value ?? undefined;
    if (!graphSettings.highlightCycles) {
      return base;
    }

    const src = source.value;
    const tgt = target.value;
    const ids = cycleModuleIds.value;
    const participates = Boolean(src) && Boolean(tgt) && ids.has(src) && ids.has(tgt);

    if (participates) {
      return {
        ...(base ?? {}),
        stroke: 'rgb(239, 68, 68)',
        strokeWidth: 3,
        strokeOpacity: 1,
      };
    }

    return {
      ...(base ?? {}),
      opacity: 0.4,
    };
  });

  return { style };
}

function parseParticipants(cycle: DependencyCycle): string[] {
  if (!cycle.participants_json) return [];
  try {
    const parsed: unknown = JSON.parse(cycle.participants_json);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        out.push(entry);
        continue;
      }
      if (entry !== null && typeof entry === 'object') {
        const obj = entry as { id?: unknown; module_id?: unknown };
        if (typeof obj.id === 'string') {
          out.push(obj.id);
        } else if (typeof obj.module_id === 'string') {
          out.push(obj.module_id);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
