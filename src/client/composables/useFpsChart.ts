import { computed } from 'vue';

import type { ComputedRef, Ref } from 'vue';

export interface UseFpsChartOptions {
  fpsHistory: Ref<number[]>;
  width?: number;
  height?: number;
}

export interface FpsChart {
  fpsChartScaleMax: ComputedRef<number>;
  fpsChartPoints: ComputedRef<string>;
  fpsTargetLineY: ComputedRef<string>;
  FPS_CHART_WIDTH: number;
  FPS_CHART_HEIGHT: number;
}

export function useFpsChart(options: UseFpsChartOptions): FpsChart {
  const { fpsHistory, width = 220, height = 56 } = options;

  const FPS_CHART_WIDTH = width;
  const FPS_CHART_HEIGHT = height;

  const fpsChartScaleMax = computed(() => {
    if (!fpsHistory.value.length) return 60;
    return Math.max(60, ...fpsHistory.value);
  });

  const fpsChartPoints = computed(() => {
    const samples = fpsHistory.value;
    if (!samples.length) return '';
    const maxScale = fpsChartScaleMax.value;
    if (samples.length === 1) {
      const onlySample = samples[0];
      if (onlySample === undefined) return '';
      const normalized = Math.max(0, Math.min(onlySample / maxScale, 1));
      const y = FPS_CHART_HEIGHT - normalized * FPS_CHART_HEIGHT;
      return `0.0,${y.toFixed(1)} ${FPS_CHART_WIDTH.toFixed(1)},${y.toFixed(1)}`;
    }
    const step = FPS_CHART_WIDTH / (samples.length - 1);
    return samples
      .map((sample, index) => {
        const normalized = Math.max(0, Math.min(sample / maxScale, 1));
        const x = index * step;
        const y = FPS_CHART_HEIGHT - normalized * FPS_CHART_HEIGHT;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  const fpsTargetLineY = computed(() => {
    const ratio = Math.min(60 / fpsChartScaleMax.value, 1);
    return (FPS_CHART_HEIGHT - ratio * FPS_CHART_HEIGHT).toFixed(1);
  });

  return {
    fpsChartScaleMax,
    fpsChartPoints,
    fpsTargetLineY,
    FPS_CHART_WIDTH,
    FPS_CHART_HEIGHT,
  };
}
