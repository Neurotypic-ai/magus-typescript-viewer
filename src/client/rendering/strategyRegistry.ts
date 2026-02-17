import { isRenderingStrategyId } from './RenderingStrategy';

import type {
  RenderingNumberOptionDefinition,
  RenderingOptionValue,
  RenderingStrategy,
  RenderingStrategyId,
  RenderingStrategyOptionsById,
} from './RenderingStrategy';

const DEGREE_WEIGHTED_LAYERS_OPTION = {
  id: 'degreeWeightedLayers',
  type: 'boolean' as const,
  label: 'Degree-weighted layers',
  description: 'Weight layer assignment by node degree for more balanced layouts.',
  defaultValue: false,
};

const MINIMUM_DISTANCE_PX_OPTION = {
  id: 'minimumDistancePx',
  type: 'number' as const,
  label: 'Minimum distance (px)',
  description: 'Minimum spacing between nodes and folder bounds for collision resolution.',
  defaultValue: 40,
  min: 20,
  max: 100,
  step: 5,
};

export const RENDERING_STRATEGY_IDS: readonly RenderingStrategyId[] = ['canvas', 'vueflow', 'folderDistributor'];

export const RENDERING_STRATEGIES = new Map<RenderingStrategyId, RenderingStrategy>([
  [
    'canvas',
    {
      id: 'canvas',
      label: 'Hybrid Canvas',
      description: 'Draw edges with a canvas overlay for better large-graph performance.',
      options: [DEGREE_WEIGHTED_LAYERS_OPTION],
      runtime: {
        edgeMode: 'canvas',
        supportsDirection: true,
        supportsDegreeWeightedLayers: true,
        buildMode: 'overview',
        supportsIsolation: true,
        forcesClusterByFolder: false,
      },
    },
  ],
  [
    'vueflow',
    {
      id: 'vueflow',
      label: 'Vue Flow SVG',
      description: 'Render all edges with Vue Flow SVG paths.',
      options: [DEGREE_WEIGHTED_LAYERS_OPTION],
      runtime: {
        edgeMode: 'vueflow',
        supportsDirection: true,
        supportsDegreeWeightedLayers: true,
        buildMode: 'overview',
        supportsIsolation: true,
        forcesClusterByFolder: false,
      },
    },
  ],
  [
    'folderDistributor',
    {
      id: 'folderDistributor',
      label: 'Folder View',
      description: 'Prioritize folder grouping and node distribution with no rendered edges.',
      options: [MINIMUM_DISTANCE_PX_OPTION],
      runtime: {
        edgeMode: 'vueflow',
        supportsDirection: true,
        supportsDegreeWeightedLayers: false,
        buildMode: 'folderDistributor',
        supportsIsolation: true,
        forcesClusterByFolder: true,
      },
    },
  ],
]);

const FALLBACK_STRATEGY: RenderingStrategy = (() => {
  const strategy = RENDERING_STRATEGIES.get('canvas');
  if (!strategy) {
    throw new Error('Rendering strategy registry is missing canvas strategy.');
  }
  return strategy;
})();

function isRenderingOptionValue(value: unknown): value is RenderingOptionValue {
  return typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getRenderingStrategy(id: string): RenderingStrategy {
  if (isRenderingStrategyId(id)) {
    return RENDERING_STRATEGIES.get(id) ?? FALLBACK_STRATEGY;
  }
  return FALLBACK_STRATEGY;
}

export function getRenderingStrategies(): RenderingStrategy[] {
  return RENDERING_STRATEGY_IDS.map((id) => getRenderingStrategy(id));
}

export function createDefaultStrategyOptionsById(): RenderingStrategyOptionsById {
  const defaults = {
    canvas: {},
    vueflow: {},
    folderDistributor: {},
  } as RenderingStrategyOptionsById;

  for (const strategyId of RENDERING_STRATEGY_IDS) {
    const strategy = getRenderingStrategy(strategyId);
    const optionDefaults = strategy.options.reduce<Record<string, unknown>>((acc, option) => {
      acc[option.id] = option.defaultValue;
      return acc;
    }, {});
    defaults[strategyId] = optionDefaults;
  }

  return defaults;
}

function clampNumberOption(
  value: number,
  option: RenderingNumberOptionDefinition
): number {
  let clamped = value;
  if (option.min !== undefined && clamped < option.min) {
    clamped = option.min;
  }
  if (option.max !== undefined && clamped > option.max) {
    clamped = option.max;
  }
  return clamped;
}

export function sanitizeStrategyOptionsById(value: unknown): RenderingStrategyOptionsById {
  const defaults = createDefaultStrategyOptionsById();
  if (!isRecord(value)) {
    return defaults;
  }

  const next = { ...defaults } as RenderingStrategyOptionsById;
  for (const strategyId of RENDERING_STRATEGY_IDS) {
    const strategy = getRenderingStrategy(strategyId);
    const rawOptions = value[strategyId];
    if (!isRecord(rawOptions)) {
      continue;
    }
    const sanitizedStrategyOptions = { ...next[strategyId] };
    for (const [optionId, optionValue] of Object.entries(rawOptions)) {
      if (!isRenderingOptionValue(optionValue)) {
        continue;
      }
      const optionDef = strategy.options.find((o) => o.id === optionId);
      if (optionDef?.type === 'number' && typeof optionValue === 'number') {
        const numOption = optionDef;
        sanitizedStrategyOptions[optionId] = clampNumberOption(optionValue, numOption);
      } else {
        sanitizedStrategyOptions[optionId] = optionValue;
      }
    }
    next[strategyId] = sanitizedStrategyOptions;
  }

  return next;
}
