<script setup lang="ts">
import { Panel } from '@vue-flow/core';
import { computed, ref } from 'vue';

import { getRenderingStrategies } from '../rendering/strategyRegistry';
import { DEFAULT_MODULE_MEMBER_TYPES, DEFAULT_RELATIONSHIP_TYPES, useGraphSettings } from '../stores/graphSettings';

import type {
  RenderingNumberOptionDefinition,
  RenderingOptionDefinition,
  RenderingOptionValue,
  RenderingSelectOptionDefinition,
  RenderingStrategy,
  RenderingStrategyId,
} from '../rendering/RenderingStrategy';
import type { ModuleMemberType } from '../stores/graphSettings';

interface GraphControlsProps {
  relationshipAvailability?: Record<string, { available: boolean; reason?: string }>;
  canvasRendererAvailable?: boolean;
}

const props = withDefaults(defineProps<GraphControlsProps>(), {
  relationshipAvailability: () => ({}),
  canvasRendererAvailable: true,
});

const emit = defineEmits<{
  'relationship-filter-change': [types: string[]];
  'node-type-filter-change': [types: string[]];
  'reset-layout': [];
  'reset-view': [];
  'layout-change': [config: { algorithm?: string; direction?: string; nodeSpacing?: number; rankSpacing?: number }];
  'toggle-collapse-scc': [value: boolean];
  'toggle-cluster-folder': [value: boolean];
  'toggle-hide-test-files': [value: boolean];
  'member-node-mode-change': [value: 'compact' | 'graph'];
  'toggle-orphan-global': [value: boolean];
  'toggle-degree-weighted-layers': [value: boolean];
  'toggle-show-fps': [value: boolean];
  'toggle-fps-advanced': [value: boolean];
  'rendering-strategy-change': [id: RenderingStrategyId];
  'rendering-strategy-option-change': [
    payload: { strategyId: RenderingStrategyId; optionId: string; value: RenderingOptionValue },
  ];
}>();

const graphSettings = useGraphSettings();

// Layout configuration
const layoutAlgorithm = ref<'layered' | 'radial' | 'force' | 'stress'>('layered');
const layoutDirection = ref<'LR' | 'RL' | 'TB' | 'BT'>('LR');
const nodeSpacing = ref(100);
const rankSpacing = ref(150);

const renderingStrategies = getRenderingStrategies();
const fallbackRenderingStrategy = renderingStrategies[0];
if (!fallbackRenderingStrategy) {
  throw new Error('Rendering strategy registry is empty.');
}
const canvasUnavailableMessageId = 'rendering-strategy-canvas-unavailable-copy';

const handleResetView = () => {
  emit('reset-view');
};

const handleResetLayout = () => {
  layoutAlgorithm.value = 'layered';
  layoutDirection.value = 'LR';
  nodeSpacing.value = 100;
  rankSpacing.value = 150;
  emit('reset-layout');
};

const relationshipTypes = [...DEFAULT_RELATIONSHIP_TYPES];
const nodeTypes = ['module', 'class', 'interface', 'package'] as const;

const moduleMemberTypes = [...DEFAULT_MODULE_MEMBER_TYPES];
const moduleMemberLabels: Record<ModuleMemberType, string> = {
  function: 'Functions',
  type: 'Type Aliases',
  enum: 'Enums',
  const: 'Constants',
  var: 'Variables',
};

const getRelationshipAvailability = (type: string) => props.relationshipAvailability[type] ?? { available: true };
const isRelationshipDisabled = (type: string) => !getRelationshipAvailability(type).available;
const relationshipReason = (type: string) => getRelationshipAvailability(type).reason ?? 'Unavailable';

const activeRenderingStrategy = computed<RenderingStrategy>(() => {
  return renderingStrategies.find((strategy) => strategy.id === graphSettings.renderingStrategyId) ?? fallbackRenderingStrategy;
});

const shouldShowDegreeWeightedLayersControl = computed(() => {
  return layoutAlgorithm.value === 'layered' && activeRenderingStrategy.value.runtime.supportsDegreeWeightedLayers;
});

const isRenderingStrategyDisabled = (strategyId: RenderingStrategyId): boolean => {
  return strategyId === 'canvas' && !props.canvasRendererAvailable;
};

const getEnabledRenderingStrategyIds = (): RenderingStrategyId[] => {
  return renderingStrategies.filter((strategy) => !isRenderingStrategyDisabled(strategy.id)).map((strategy) => strategy.id);
};

const firstEnabledRenderingStrategyId = computed<RenderingStrategyId | null>(() => {
  return getEnabledRenderingStrategyIds()[0] ?? null;
});

const getRenderingStrategyTabIndex = (strategyId: RenderingStrategyId): number => {
  if (isRenderingStrategyDisabled(strategyId)) {
    return -1;
  }

  const activeStrategyId = graphSettings.renderingStrategyId;
  if (!isRenderingStrategyDisabled(activeStrategyId)) {
    return activeStrategyId === strategyId ? 0 : -1;
  }

  return firstEnabledRenderingStrategyId.value === strategyId ? 0 : -1;
};

const findAdjacentEnabledStrategyId = (currentStrategyId: RenderingStrategyId, direction: 1 | -1): RenderingStrategyId | null => {
  const enabledStrategyIds = getEnabledRenderingStrategyIds();
  if (enabledStrategyIds.length === 0) {
    return null;
  }

  const currentIndex = enabledStrategyIds.indexOf(currentStrategyId);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + direction + enabledStrategyIds.length) % enabledStrategyIds.length;
  return enabledStrategyIds[nextIndex] ?? null;
};

const focusRenderingStrategyRadio = (sourceTarget: EventTarget | null, strategyId: RenderingStrategyId): void => {
  if (!(sourceTarget instanceof HTMLElement)) {
    return;
  }

  const radioGroup = sourceTarget.closest('[role="radiogroup"]');
  if (!radioGroup) {
    return;
  }

  const nextRadio = radioGroup.querySelector<HTMLElement>(
    `[role="radio"][data-rendering-strategy-id="${strategyId}"]`
  );
  nextRadio?.focus();
};

const handleRenderingStrategyChange = (strategyId: RenderingStrategyId): void => {
  if (isRenderingStrategyDisabled(strategyId)) {
    return;
  }
  emit('rendering-strategy-change', strategyId);
};

const handleRenderingStrategyRadioKeydown = (event: KeyboardEvent, strategyId: RenderingStrategyId): void => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const previousStrategyId = findAdjacentEnabledStrategyId(strategyId, -1);
    if (previousStrategyId) {
      handleRenderingStrategyChange(previousStrategyId);
      focusRenderingStrategyRadio(event.currentTarget, previousStrategyId);
    }
    return;
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    const nextStrategyId = findAdjacentEnabledStrategyId(strategyId, 1);
    if (nextStrategyId) {
      handleRenderingStrategyChange(nextStrategyId);
      focusRenderingStrategyRadio(event.currentTarget, nextStrategyId);
    }
    return;
  }

  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    handleRenderingStrategyChange(strategyId);
  }
};

const isRenderingOptionVisible = (strategyId: RenderingStrategyId, option: RenderingOptionDefinition): boolean => {
  if (!option.isVisible) {
    return true;
  }
  return option.isVisible({
    strategyId,
    strategyOptionsById: graphSettings.strategyOptionsById,
  });
};

const isRenderingOptionEnabled = (strategyId: RenderingStrategyId, option: RenderingOptionDefinition): boolean => {
  if (isRenderingStrategyDisabled(strategyId)) {
    return false;
  }
  if (!option.isEnabled) {
    return true;
  }
  return option.isEnabled({
    strategyId,
    strategyOptionsById: graphSettings.strategyOptionsById,
  });
};

const activeRenderingOptions = computed(() => {
  const strategyId = activeRenderingStrategy.value.id;
  return activeRenderingStrategy.value.options.filter((option) => isRenderingOptionVisible(strategyId, option));
});

const getStoredRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition
): unknown => {
  const strategyOptions = graphSettings.strategyOptionsById[strategyId] ?? {};
  const storedValue = strategyOptions[option.id];
  return typeof storedValue === 'undefined' ? option.defaultValue : storedValue;
};

const getBooleanRenderingOptionValue = (strategyId: RenderingStrategyId, option: RenderingOptionDefinition): boolean => {
  const value = getStoredRenderingOptionValue(strategyId, option);
  return typeof value === 'boolean' ? value : Boolean(option.defaultValue);
};

const getSelectRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingSelectOptionDefinition
): string => {
  const value = getStoredRenderingOptionValue(strategyId, option);
  return typeof value === 'string' ? value : option.defaultValue;
};

const getNumberRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingNumberOptionDefinition
): number => {
  const value = getStoredRenderingOptionValue(strategyId, option);
  return typeof value === 'number' && Number.isFinite(value) ? value : option.defaultValue;
};

const handleRenderingStrategyOptionChange = (
  strategyId: RenderingStrategyId,
  optionId: string,
  value: RenderingOptionValue
): void => {
  emit('rendering-strategy-option-change', { strategyId, optionId, value });
};

const handleBooleanRenderingOptionChange = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition,
  checked: boolean
): void => {
  handleRenderingStrategyOptionChange(strategyId, option.id, checked);
};

const handleSelectRenderingOptionChange = (
  strategyId: RenderingStrategyId,
  option: RenderingSelectOptionDefinition,
  value: string
): void => {
  handleRenderingStrategyOptionChange(strategyId, option.id, value);
};

const normalizeNumberOptionValue = (option: RenderingNumberOptionDefinition, rawValue: string): number => {
  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue)) {
    return option.defaultValue;
  }

  let normalizedValue = parsedValue;
  if (typeof option.min === 'number') {
    normalizedValue = Math.max(option.min, normalizedValue);
  }
  if (typeof option.max === 'number') {
    normalizedValue = Math.min(option.max, normalizedValue);
  }
  return normalizedValue;
};

const handleNumberRenderingOptionChange = (
  strategyId: RenderingStrategyId,
  option: RenderingNumberOptionDefinition,
  rawValue: string
): void => {
  const normalizedValue = normalizeNumberOptionValue(option, rawValue);
  handleRenderingStrategyOptionChange(strategyId, option.id, normalizedValue);
};

const handleModuleMemberTypeToggle = (type: ModuleMemberType, checked: boolean) => {
  graphSettings.toggleModuleMemberType(type, checked);
};

const toggleListItem = (values: string[], value: string, enabled: boolean): string[] => {
  if (enabled) {
    return values.includes(value) ? values : [...values, value];
  }
  return values.filter((item) => item !== value);
};

const handleRelationshipFilterChange = (type: string, checked: boolean) => {
  if (isRelationshipDisabled(type)) {
    return;
  }
  const nextTypes = toggleListItem(graphSettings.enabledRelationshipTypes, type, checked);
  emit('relationship-filter-change', nextTypes);
};

const handleNodeTypeFilterChange = (type: (typeof nodeTypes)[number], checked: boolean) => {
  const nextTypes = toggleListItem(graphSettings.enabledNodeTypes, type, checked);
  emit('node-type-filter-change', nextTypes);
};

const handleAlgorithmChange = (algorithm: 'layered' | 'radial' | 'force' | 'stress') => {
  layoutAlgorithm.value = algorithm;
  emit('layout-change', { algorithm });
};

const handleDirectionChange = (direction: 'LR' | 'RL' | 'TB' | 'BT') => {
  layoutDirection.value = direction;
  emit('layout-change', { direction });
};

const handleSpacingChange = () => {
  emit('layout-change', {
    nodeSpacing: nodeSpacing.value,
    rankSpacing: rankSpacing.value,
  });
};

const handleCollapseSccToggle = (checked: boolean) => {
  emit('toggle-collapse-scc', checked);
};

const handleClusterByFolderToggle = (checked: boolean) => {
  emit('toggle-cluster-folder', checked);
};

const handleHideTestFilesToggle = (checked: boolean) => {
  emit('toggle-hide-test-files', checked);
};

const handleMemberNodeModeChange = (mode: 'compact' | 'graph') => {
  emit('member-node-mode-change', mode);
};

const handleOrphanGlobalToggle = (checked: boolean) => {
  emit('toggle-orphan-global', checked);
};

const handleDegreeWeightedLayersToggle = (checked: boolean) => {
  emit('toggle-degree-weighted-layers', checked);
};

const handleShowFpsToggle = (checked: boolean) => {
  emit('toggle-show-fps', checked);
};

const handleFpsAdvancedToggle = (checked: boolean) => {
  emit('toggle-fps-advanced', checked);
};
</script>

<template>
  <Panel position="top-left">
    <div class="bg-background-paper p-4 rounded-lg border border-border-default shadow-xl">
      <!-- View Actions -->
      <div class="flex gap-2 mb-4">
        <button
          @click="handleResetView"
          class="px-3 py-1.5 bg-white/10 text-text-primary rounded hover:bg-white/20 transition-fast border border-border-default text-xs font-semibold"
          aria-label="Reset view"
        >
          Reset View
        </button>
        <button
          @click="handleResetLayout"
          class="px-3 py-1.5 bg-white/10 text-text-primary rounded hover:bg-white/20 transition-fast border border-border-default text-xs font-semibold"
          aria-label="Reset layout"
        >
          Reset Layout
        </button>
      </div>

      <!-- Layout Algorithm -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Layout Algorithm</h4>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="algo in ['layered', 'radial', 'force', 'stress']"
            :key="algo"
            @click="handleAlgorithmChange(algo as 'layered' | 'radial' | 'force' | 'stress')"
            :class="[
              'px-2 py-1.5 text-xs rounded border transition-fast capitalize',
              layoutAlgorithm === algo
                ? 'bg-primary-main text-white border-primary-main'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
            ]"
            :aria-label="`Set layout algorithm to ${algo}`"
          >
            {{ algo }}
          </button>
        </div>
      </div>

      <!-- Layout Direction -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Layout Direction</h4>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="dir in ['LR', 'RL', 'TB', 'BT']"
            :key="dir"
            @click="handleDirectionChange(dir as 'LR' | 'RL' | 'TB' | 'BT')"
            :class="[
              'px-2 py-1.5 text-xs rounded border transition-fast',
              layoutDirection === dir
                ? 'bg-primary-main text-white border-primary-main'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
            ]"
            :aria-label="`Set layout direction to ${dir}`"
          >
            {{ dir }}
          </button>
        </div>
      </div>

      <!-- Degree-Weighted Layers (runtime + layered algorithm only) -->
      <div v-if="shouldShowDegreeWeightedLayersControl" class="mt-3">
        <label
          class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
        >
          <input
            type="checkbox"
            class="cursor-pointer accent-primary-main"
            :checked="graphSettings.degreeWeightedLayers"
            @change="(e) => handleDegreeWeightedLayersToggle((e.target as HTMLInputElement).checked)"
          />
          <span class="text-xs">Degree-weighted layers</span>
        </label>
      </div>

      <!-- Spacing Controls -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Spacing</h4>
        <div class="flex flex-col gap-3">
          <div>
            <label class="text-xs text-text-secondary block mb-1"> Node Spacing: {{ nodeSpacing }} </label>
            <input
              v-model.number="nodeSpacing"
              type="range"
              min="50"
              max="200"
              step="10"
              @change="handleSpacingChange"
              class="w-full cursor-pointer accent-primary-main"
            />
          </div>
          <div>
            <label class="text-xs text-text-secondary block mb-1"> Rank Spacing: {{ rankSpacing }} </label>
            <input
              v-model.number="rankSpacing"
              type="range"
              min="100"
              max="300"
              step="10"
              @change="handleSpacingChange"
              class="w-full cursor-pointer accent-primary-main"
            />
          </div>
        </div>
      </div>

      <!-- Clustering -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Clustering</h4>
        <div class="flex flex-col gap-2">
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="graphSettings.collapseScc"
              :disabled="graphSettings.clusterByFolder"
              @change="(e) => handleCollapseSccToggle((e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Collapse cycles (SCC)</span>
          </label>
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="graphSettings.clusterByFolder"
              @change="(e) => handleClusterByFolderToggle((e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Cluster by folder</span>
          </label>
        </div>
      </div>

      <!-- Node Types -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Node Types</h4>
        <div class="flex flex-col gap-1.5">
          <label
            v-for="nodeType in nodeTypes"
            :key="nodeType"
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              :checked="graphSettings.enabledNodeTypes.includes(nodeType)"
              @change="(e) => handleNodeTypeFilterChange(nodeType, (e.target as HTMLInputElement).checked)"
              class="cursor-pointer accent-primary-main"
            />
            <span class="text-xs capitalize">{{ nodeType }}</span>
          </label>
        </div>
      </div>

      <!-- Module Sections -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-1">Module Sections</h4>
        <p class="text-[10px] text-text-secondary mb-2 leading-tight">Toggle which entity types are shown inside module nodes</p>
        <div class="flex flex-col gap-1.5">
          <label
            v-for="memberType in moduleMemberTypes"
            :key="memberType"
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              :checked="graphSettings.enabledModuleMemberTypes.includes(memberType)"
              @change="(e) => handleModuleMemberTypeToggle(memberType, (e.target as HTMLInputElement).checked)"
              class="cursor-pointer accent-primary-main"
            />
            <span class="text-xs">{{ moduleMemberLabels[memberType] }}</span>
          </label>
        </div>
      </div>

      <!-- Member Display Mode -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-1">Member Display</h4>
        <p class="text-[10px] text-text-secondary mb-2 leading-tight">How properties and methods render within class/interface nodes</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            @click="handleMemberNodeModeChange('compact')"
            :class="[
              'px-2 py-1.5 text-xs rounded border transition-fast',
              graphSettings.memberNodeMode === 'compact'
                ? 'bg-primary-main text-white border-primary-main'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
            ]"
            aria-label="Set member display mode to compact"
          >
            Compact
          </button>
          <button
            @click="handleMemberNodeModeChange('graph')"
            :class="[
              'px-2 py-1.5 text-xs rounded border transition-fast',
              graphSettings.memberNodeMode === 'graph'
                ? 'bg-primary-main text-white border-primary-main'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
            ]"
            aria-label="Set member display mode to separate nodes"
          >
            Separate Nodes
          </button>
        </div>
      </div>

      <!-- Analysis Filters -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Analysis</h4>
        <div class="flex flex-col gap-2">
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="graphSettings.hideTestFiles"
              @change="(e) => handleHideTestFilesToggle((e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Hide test files</span>
          </label>
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="graphSettings.highlightOrphanGlobal"
              @change="(e) => handleOrphanGlobalToggle((e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Highlight global orphans</span>
          </label>
        </div>
      </div>

      <!-- Rendering Strategy -->
      <fieldset class="mt-4 pt-4 border-t border-border-default">
        <legend class="text-sm font-semibold text-text-primary mb-1">Rendering Strategy</legend>
        <p class="text-[10px] text-text-secondary mb-2 leading-tight">
          Choose a strategy for edge rendering and graph runtime behavior.
        </p>
        <div role="radiogroup" aria-label="Rendering strategy" class="flex flex-col gap-2">
          <button
            v-for="strategy in renderingStrategies"
            :key="strategy.id"
            type="button"
            role="radio"
            :aria-checked="graphSettings.renderingStrategyId === strategy.id"
            :aria-disabled="isRenderingStrategyDisabled(strategy.id)"
            :aria-describedby="
              isRenderingStrategyDisabled(strategy.id) && strategy.id === 'canvas' ? canvasUnavailableMessageId : undefined
            "
            :disabled="isRenderingStrategyDisabled(strategy.id)"
            :tabindex="getRenderingStrategyTabIndex(strategy.id)"
            :data-rendering-strategy-id="strategy.id"
            :class="[
              'w-full rounded border px-2 py-2 text-left transition-fast',
              graphSettings.renderingStrategyId === strategy.id
                ? 'bg-primary-main/20 border-primary-main text-text-primary'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
              isRenderingStrategyDisabled(strategy.id) ? 'cursor-not-allowed opacity-50 hover:bg-white/10' : '',
            ]"
            @click="handleRenderingStrategyChange(strategy.id)"
            @keydown="(event) => handleRenderingStrategyRadioKeydown(event, strategy.id)"
          >
            <div class="text-xs font-semibold">{{ strategy.label }}</div>
            <div class="text-[10px] leading-tight text-text-secondary">{{ strategy.description }}</div>
          </button>
        </div>
        <p
          v-if="!props.canvasRendererAvailable"
          :id="canvasUnavailableMessageId"
          class="text-[10px] text-text-muted mt-2 leading-tight"
        >
          Canvas strategy is unavailable in this browser session.
        </p>
        <div v-if="activeRenderingOptions.length > 0" class="mt-3 space-y-2">
          <h5 class="text-[11px] font-semibold text-text-primary">{{ activeRenderingStrategy.label }} options</h5>
          <div
            v-for="option in activeRenderingOptions"
            :key="`${activeRenderingStrategy.id}-${option.id}`"
            class="rounded border border-border-default bg-white/5 px-2 py-2"
          >
            <label
              :for="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
              class="text-xs font-medium text-text-primary"
            >
              {{ option.label }}
            </label>
            <p class="mb-2 text-[10px] leading-tight text-text-secondary">{{ option.description }}</p>

            <input
              v-if="option.type === 'boolean'"
              :id="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="getBooleanRenderingOptionValue(activeRenderingStrategy.id, option)"
              :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
              @change="
                (event) =>
                  handleBooleanRenderingOptionChange(
                    activeRenderingStrategy.id,
                    option,
                    (event.target as HTMLInputElement).checked
                  )
              "
            />

            <select
              v-else-if="option.type === 'select'"
              :id="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
              class="w-full rounded border border-border-default bg-background-paper px-2 py-1 text-xs text-text-primary"
              :value="getSelectRenderingOptionValue(activeRenderingStrategy.id, option)"
              :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
              @change="
                (event) =>
                  handleSelectRenderingOptionChange(
                    activeRenderingStrategy.id,
                    option,
                    (event.target as HTMLSelectElement).value
                  )
              "
            >
              <option v-for="selectOption in option.options" :key="selectOption.value" :value="selectOption.value">
                {{ selectOption.label }}
              </option>
            </select>

            <input
              v-else
              :id="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
              type="number"
              class="w-full rounded border border-border-default bg-background-paper px-2 py-1 text-xs text-text-primary"
              :min="option.min"
              :max="option.max"
              :step="option.step ?? 1"
              :value="getNumberRenderingOptionValue(activeRenderingStrategy.id, option)"
              :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
              @change="
                (event) =>
                  handleNumberRenderingOptionChange(
                    activeRenderingStrategy.id,
                    option,
                    (event.target as HTMLInputElement).value
                  )
              "
            />
          </div>
        </div>
      </fieldset>

      <!-- Performance -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Performance</h4>
        <div class="flex flex-col gap-2">
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="graphSettings.showFps"
              @change="(e) => handleShowFpsToggle((e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Show FPS</span>
          </label>
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              :checked="graphSettings.showFpsAdvanced"
              @change="(e) => handleFpsAdvancedToggle((e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Advanced</span>
          </label>
        </div>
      </div>

      <!-- Filter Panel -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Relationship Types</h4>
        <div class="flex flex-col gap-1.5">
          <label
            v-for="type in relationshipTypes"
            :key="type"
            class="flex items-center gap-2 text-sm text-text-secondary transition-fast"
            :class="[
              isRelationshipDisabled(type)
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:text-text-primary',
            ]"
          >
            <input
              type="checkbox"
              :checked="graphSettings.enabledRelationshipTypes.includes(type)"
              :disabled="isRelationshipDisabled(type)"
              @change="(e) => handleRelationshipFilterChange(type, (e.target as HTMLInputElement).checked)"
              class="cursor-pointer accent-primary-main"
            />
            <span class="text-xs capitalize">
              {{ type }}
              <span v-if="isRelationshipDisabled(type)" class="text-text-muted"> ({{ relationshipReason(type) }}) </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  </Panel>
</template>
