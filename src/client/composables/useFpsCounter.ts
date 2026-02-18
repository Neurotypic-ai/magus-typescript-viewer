import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue';

const MAX_FPS_HISTORY_POINTS = 90;

export interface FpsStatsSummary {
  min: number;
  max: number;
  avg: number;
  p90: number;
  sampleCount: number;
}

export interface UseFpsCounterResult {
  fps: Ref<number>;
  fpsHistory: Ref<number[]>;
  fpsStats: ComputedRef<FpsStatsSummary>;
  start: () => void;
  stop: () => void;
}

/**
 * Composable that measures rendering FPS using requestAnimationFrame.
 *
 * Counts frames over a rolling 1-second window for a smooth, stable reading.
 * The rAF loop only runs while `enabled` is true, so there's zero overhead
 * when the counter is hidden.
 */
export function useFpsCounter(enabled: Readonly<Ref<boolean>>): UseFpsCounterResult {
  const fps = ref(0);
  const fpsHistory = ref<number[]>([]);
  const fpsStats = computed<FpsStatsSummary>(() => {
    const samples = fpsHistory.value;
    if (!samples.length) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        p90: 0,
        sampleCount: 0,
      };
    }

    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const avgRaw = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const sorted = [...samples].sort((a, b) => a - b);
    const p90Index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);

    return {
      min,
      max,
      avg: Number(avgRaw.toFixed(1)),
      p90: sorted[p90Index] ?? 0,
      sampleCount: samples.length,
    };
  });

  let rafId: number | null = null;
  let frameCount = 0;
  let lastTimestamp = 0;

  const tick = (timestamp: number): void => {
    if (!enabled.value) {
      rafId = null;
      return;
    }

    frameCount++;

    if (lastTimestamp === 0) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;
    if (elapsed >= 1000) {
      const nextFps = Math.round((frameCount * 1000) / elapsed);
      fps.value = nextFps;
      fpsHistory.value.push(nextFps);
      if (fpsHistory.value.length > MAX_FPS_HISTORY_POINTS) {
        fpsHistory.value.splice(0, fpsHistory.value.length - MAX_FPS_HISTORY_POINTS);
      }
      frameCount = 0;
      lastTimestamp = timestamp;
    }

    rafId = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (rafId !== null) return;
    frameCount = 0;
    lastTimestamp = 0;
    fps.value = 0;
    fpsHistory.value = [];
    rafId = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    fps.value = 0;
    fpsHistory.value = [];
  };

  onUnmounted(stop);

  return { fps, fpsHistory, fpsStats, start, stop };
}
