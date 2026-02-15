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
  degreeWeightedLayers: boolean;
  margins: LayoutMargins;
  animationDuration: number;
  theme: GraphTheme;
}

export const defaultLayoutConfig: LayoutConfig = {
  algorithm: 'layered',
  direction: 'LR', // Left-to-right works better for hierarchical dependency graphs
  nodeSpacing: 80,
  rankSpacing: 200,
  edgeSpacing: 30,
  degreeWeightedLayers: false,
  margins: {
    top: 80,
    right: 80,
    bottom: 80,
    left: 80,
  },
  animationDuration: 150,
  theme: graphTheme,
};
