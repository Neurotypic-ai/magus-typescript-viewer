import { computed, ref } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { measurePerformance } from '../../utils/performanceMonitoring';
import { useEdgeVirtualization } from './useEdgeVirtualization';
import { useEdgeVirtualizationWorker } from './useEdgeVirtualizationWorker';

import type { Ref } from 'vue';

import type { DependencyNode, GraphEdge } from './types';

const orchestratorLogger = createLogger('EdgeVirtualizationOrchestrator');

export interface UseEdgeVirtualizationOrchestratorOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  getViewport: () => { x: number; y: number; zoom: number };
  getContainerRect: () => DOMRect | null;
  setEdgeVisibility: (visibilityMap: Map<string, boolean>) => void;
  initialMode: 'main' | 'worker';
  throttleMs: number;
  perfMarksEnabled: boolean;
}

export interface EdgeVirtualizationOrchestrator {
  edgeVirtualizationEnabled: Ref<boolean>;
  edgeVirtualizationRuntimeMode: Ref<'main' | 'worker'>;
  edgeVirtualizationWorkerStats: Ref<{
    lastVisibleCount: number;
    lastHiddenCount: number;
    staleResponses: number;
  }>;
  requestViewportRecalc: (force?: boolean) => void;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
}

export function useEdgeVirtualizationOrchestrator(
  options: UseEdgeVirtualizationOrchestratorOptions
): EdgeVirtualizationOrchestrator {
  const {
    nodes,
    edges,
    getViewport,
    getContainerRect,
    setEdgeVisibility,
    initialMode,
    throttleMs,
    perfMarksEnabled,
  } = options;

  const edgeVirtualizationEnabled = ref(true);
  const edgeVirtualizationRuntimeMode = ref<'main' | 'worker'>(initialMode);

  let edgeViewportRecalcTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEdgeViewportRecalcAt = 0;

  const edgeVirtualizationMainEnabled = computed(() => {
    return edgeVirtualizationEnabled.value && edgeVirtualizationRuntimeMode.value === 'main';
  });

  const edgeVirtualizationWorkerEnabled = computed(() => {
    return edgeVirtualizationEnabled.value && edgeVirtualizationRuntimeMode.value === 'worker';
  });

  const handleWorkerUnavailable = (reason: string): void => {
    if (edgeVirtualizationRuntimeMode.value !== 'worker') {
      return;
    }
    edgeVirtualizationRuntimeMode.value = 'main';
    orchestratorLogger.warn(`Edge visibility worker unavailable (${reason}). Falling back to main-thread virtualization.`);
  };

  const mainVirtualization = useEdgeVirtualization({
    nodes,
    edges,
    getViewport,
    getContainerRect,
    setEdgeVisibility,
    enabled: edgeVirtualizationMainEnabled,
  });

  const workerVirtualization = useEdgeVirtualizationWorker({
    nodes,
    edges,
    getViewport,
    getContainerRect,
    setEdgeVisibility,
    enabled: edgeVirtualizationWorkerEnabled,
    onWorkerUnavailable: handleWorkerUnavailable,
  });

  const edgeVirtualizationWorkerStats = computed(() => workerVirtualization.stats.value);

  const onEdgeVirtualizationViewportChange = (): void => {
    if (edgeVirtualizationRuntimeMode.value === 'worker') {
      workerVirtualization.onViewportChange();
      return;
    }
    mainVirtualization.onViewportChange();
  };

  const requestViewportRecalc = (force = false): void => {
    if (!edgeVirtualizationEnabled.value) {
      return;
    }

    const runRecalc = () => {
      if (perfMarksEnabled) {
        performance.mark('edge-virtualization-viewport-sync-start');
      }
      onEdgeVirtualizationViewportChange();
      if (perfMarksEnabled) {
        performance.mark('edge-virtualization-viewport-sync-end');
        measurePerformance(
          'edge-virtualization-viewport-sync',
          'edge-virtualization-viewport-sync-start',
          'edge-virtualization-viewport-sync-end'
        );
      }
    };

    if (force) {
      if (edgeViewportRecalcTimer) {
        clearTimeout(edgeViewportRecalcTimer);
        edgeViewportRecalcTimer = null;
      }
      lastEdgeViewportRecalcAt = performance.now();
      runRecalc();
      return;
    }

    const now = performance.now();
    const elapsed = now - lastEdgeViewportRecalcAt;
    if (elapsed >= throttleMs) {
      lastEdgeViewportRecalcAt = now;
      runRecalc();
      return;
    }

    if (edgeViewportRecalcTimer) {
      return;
    }

    edgeViewportRecalcTimer = setTimeout(() => {
      edgeViewportRecalcTimer = null;
      lastEdgeViewportRecalcAt = performance.now();
      runRecalc();
    }, Math.max(0, throttleMs - elapsed));
  };

  const suspend = (): void => {
    mainVirtualization.suspend();
    workerVirtualization.suspend();
  };

  const resume = (): void => {
    if (edgeVirtualizationRuntimeMode.value === 'worker') {
      workerVirtualization.resume();
      return;
    }
    mainVirtualization.resume();
  };

  const dispose = (): void => {
    if (edgeViewportRecalcTimer) {
      clearTimeout(edgeViewportRecalcTimer);
      edgeViewportRecalcTimer = null;
    }
    mainVirtualization.dispose();
    workerVirtualization.dispose();
  };

  return {
    edgeVirtualizationEnabled,
    edgeVirtualizationRuntimeMode,
    edgeVirtualizationWorkerStats,
    requestViewportRecalc,
    suspend,
    resume,
    dispose,
  };
}
