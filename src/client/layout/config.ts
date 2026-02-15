import { graphTheme } from '../theme/graphTheme';

export interface LayoutConfig {
  // Core layout options
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeSpacing?: number;
  rankSpacing?: number;
  edgeSpacing?: number;
  degreeWeightedLayers?: boolean;

  // Margins and padding
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // Animation settings
  animationDuration?: number;

  // Theme integration
  theme?: typeof graphTheme;
}

export const defaultLayoutConfig: LayoutConfig = {
  direction: 'LR', // Left-to-right works better for hierarchical dependency graphs
  nodeSpacing: 100,
  rankSpacing: 150,
  edgeSpacing: 50,
  margins: {
    top: 80,
    right: 80,
    bottom: 80,
    left: 80,
  },
  animationDuration: 150,
  theme: graphTheme,
};
