export type RenderingStrategyId = 'vueflow' | 'canvas' | 'folderDistributor';

export type RenderingOptionType = 'boolean' | 'select' | 'number';
export type RenderingOptionValue = boolean | string | number;

export type RenderingStrategyOptionsById = Record<RenderingStrategyId, Record<string, unknown>>;

export interface RenderingStrategyContext {
  strategyId: RenderingStrategyId;
  strategyOptionsById: RenderingStrategyOptionsById;
}

export type RenderingOptionPredicate = (context: RenderingStrategyContext) => boolean;

interface RenderingOptionBase<TType extends RenderingOptionType, TValue extends RenderingOptionValue> {
  id: string;
  type: TType;
  label: string;
  description: string;
  defaultValue: TValue;
  isVisible?: RenderingOptionPredicate;
  isEnabled?: RenderingOptionPredicate;
}

export type RenderingBooleanOptionDefinition = RenderingOptionBase<'boolean', boolean>;

export interface RenderingSelectOption {
  value: string;
  label: string;
}

export interface RenderingSelectOptionDefinition extends RenderingOptionBase<'select', string> {
  options: readonly RenderingSelectOption[];
}

export interface RenderingNumberOptionDefinition extends RenderingOptionBase<'number', number> {
  min?: number;
  max?: number;
  step?: number;
}

export type RenderingOptionDefinition =
  | RenderingBooleanOptionDefinition
  | RenderingSelectOptionDefinition
  | RenderingNumberOptionDefinition;

export interface RenderingStrategyRuntime {
  edgeMode: 'vueflow' | 'canvas';
  supportsDirection: boolean;
  supportsDegreeWeightedLayers: boolean;
  buildMode: 'overview' | 'folderDistributor';
  supportsIsolation: boolean;
  /** When true, graph building always clusters by folder; Folder toggle is locked. */
  forcesClusterByFolder: boolean;
}

export interface RenderingStrategy {
  id: RenderingStrategyId;
  label: string;
  description: string;
  options: readonly RenderingOptionDefinition[];
  runtime: RenderingStrategyRuntime;
}

const RENDERING_STRATEGY_IDS: readonly RenderingStrategyId[] = ['vueflow', 'canvas', 'folderDistributor'];
const RENDERING_STRATEGY_ID_SET: ReadonlySet<string> = new Set(RENDERING_STRATEGY_IDS);

export function isRenderingStrategyId(value: unknown): value is RenderingStrategyId {
  return typeof value === 'string' && RENDERING_STRATEGY_ID_SET.has(value);
}
