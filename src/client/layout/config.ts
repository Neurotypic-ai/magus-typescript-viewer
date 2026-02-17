import { graphTheme } from '../theme/graphTheme';
import type { GraphTheme } from '../theme/graphTheme';

export type LayoutAlgorithm = 'layered' | 'radial' | 'force' | 'stress';
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface LayoutMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutConfig {
  algorithm: LayoutAlgorithm;
  direction: LayoutDirection;
  nodeSpacing: number;
  rankSpacing: number;
  edgeSpacing: number;
  /** From strategy options; not in defaults. */
  degreeWeightedLayers?: boolean;
  margins: LayoutMargins;
  animationDuration: number;
  theme: GraphTheme;
}

/** Frozen layout defaults; algorithm/direction/spacing are internal-only, no user mutability. */
export const defaultLayoutConfig: Readonly<LayoutConfig> = Object.freeze({
  algorithm: 'layered',
  direction: 'LR',
  nodeSpacing: 80,
  rankSpacing: 200,
  edgeSpacing: 30,
  margins: Object.freeze({
    top: 80,
    right: 80,
    bottom: 80,
    left: 80,
  }),
  animationDuration: 150,
  theme: graphTheme,
});
