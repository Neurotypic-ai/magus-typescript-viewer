import { onUnmounted, ref, type Ref } from 'vue';

/**
 * Composable that measures rendering FPS using requestAnimationFrame.
 *
 * Counts frames over a rolling 1-second window for a smooth, stable reading.
 * The rAF loop only runs while `enabled` is true, so there's zero overhead
 * when the counter is hidden.
 */
export function useFpsCounter(enabled: Ref<boolean>) {
  const fps = ref(0);

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
      fps.value = Math.round((frameCount * 1000) / elapsed);
      frameCount = 0;
      lastTimestamp = timestamp;
    }

    rafId = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (rafId !== null) return;
    frameCount = 0;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    fps.value = 0;
  };

  onUnmounted(stop);

  return { fps, start, stop };
}
