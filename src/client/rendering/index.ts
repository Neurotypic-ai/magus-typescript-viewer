import { isRenderingStrategyId } from './RenderingStrategy';

import type { RenderingOptionValue, RenderingStrategy, RenderingStrategyId } from './RenderingStrategy';

export { isRenderingStrategyId };

export type { RenderingOptionValue, RenderingStrategy, RenderingStrategyId };

export type RenderingStrategyOptionsById = Partial<Record<RenderingStrategyId, Record<string, RenderingOptionValue>>>;

export const RENDERING_STRATEGY_IDS: readonly RenderingStrategyId[] = ['canvas', 'vueflow', 'folderDistributor'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRenderingOptionValue(value: unknown): value is RenderingOptionValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  return false;
}

export function sanitizeRenderingStrategyOptionsById(value: unknown): RenderingStrategyOptionsById {
  if (!isRecord(value)) {
    return {};
  }

  const rawById = value;
  const sanitized: RenderingStrategyOptionsById = {};

  for (const strategyId of RENDERING_STRATEGY_IDS) {
    const rawOptions = rawById[strategyId];
    if (!isRecord(rawOptions)) {
      continue;
    }

    const nextOptions: Record<string, RenderingOptionValue> = {};
    for (const [optionId, candidate] of Object.entries(rawOptions)) {
      if (isRenderingOptionValue(candidate)) {
        nextOptions[optionId] = candidate;
      }
    }
    if (Object.keys(nextOptions).length > 0) {
      sanitized[strategyId] = nextOptions;
    }
  }

  return sanitized;
}
