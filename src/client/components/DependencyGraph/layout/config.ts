import { graphTheme } from '../../../theme/graphTheme';

export interface LayoutConfig {
  // Core layout options
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeSpacing?: number;
  rankSpacing?: number;
  edgeSpacing?: number;

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

// Layout-specific configurations
export interface HierarchicalLayoutConfig extends LayoutConfig {
  alignSiblings?: boolean;
  depthSeparation?: number;
}

export interface ForceLayoutConfig extends LayoutConfig {
  iterations?: number;
  strength?: number;
  distance?: number;
}

// Utility to merge configs with defaults
export function mergeConfig<T extends LayoutConfig>(config: Partial<T>, defaults: T): T {
  return {
    ...defaults,
    ...config,
    margins: {
      ...defaults.margins,
      ...(config.margins ?? {}),
    },
  };
}
