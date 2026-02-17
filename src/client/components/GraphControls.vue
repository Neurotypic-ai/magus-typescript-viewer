<script setup lang="ts">
import { Panel } from '@vue-flow/core';
import { computed } from 'vue';
import type { Ref } from 'vue';

import GraphSearch from './GraphSearch.vue';

import { getActiveCollisionConfig } from '../layout/collisionResolver';
import { getRenderingStrategies } from '../rendering/strategyRegistry';
import {
  DEFAULT_MODULE_MEMBER_TYPES,
  DEFAULT_RELATIONSHIP_TYPES,
  useGraphSettings,
} from '../stores/graphSettings';

import type {
  RenderingNumberOptionDefinition,
  RenderingOptionDefinition,
  RenderingOptionValue,
  RenderingSelectOptionDefinition,
  RenderingStrategy,
  RenderingStrategyId,
} from '../rendering/RenderingStrategy';
import type { GraphControlSectionKey, ModuleMemberType } from '../stores/graphSettings';

export interface GraphSearchContext {
  searchQuery: Ref<string>;
  runSearch: () => void;
  clearSearch?: () => void;
}

interface GraphControlsProps {
  relationshipAvailability?: Record<string, { available: boolean; reason?: string }>;
  canvasRendererAvailable?: boolean;
  graphSearchContext?: GraphSearchContext | null;
}

const props = withDefaults(defineProps<GraphControlsProps>(), {
  relationshipAvailability: () => ({}),
  canvasRendererAvailable: true,
  graphSearchContext: null,
});

const emit = defineEmits<{
  'relationship-filter-change': [types: string[]];
  'node-type-filter-change': [types: string[]];
  'toggle-collapse-scc': [value: boolean];
  'toggle-cluster-folder': [value: boolean];
  'toggle-hide-test-files': [value: boolean];
  'member-node-mode-change': [value: 'compact' | 'graph'];
  'toggle-orphan-global': [value: boolean];
  'toggle-show-fps': [value: boolean];
  'toggle-fps-advanced': [value: boolean];
  'rendering-strategy-change': [id: RenderingStrategyId];
  'rendering-strategy-option-change': [
    payload: { strategyId: RenderingStrategyId; optionId: string; value: RenderingOptionValue },
  ];
}>();

const graphSettings = useGraphSettings();

const toggleSection = (key: GraphControlSectionKey) => {
  graphSettings.setCollapsedSection(key, !graphSettings.collapsedSections[key]);
};

const isSectionCollapsed = (key: GraphControlSectionKey): boolean => graphSettings.collapsedSections[key];

const onSectionHeaderKeydown = (event: KeyboardEvent, key: GraphControlSectionKey) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleSection(key);
  }
};

const renderingStrategies = getRenderingStrategies();
const fallbackRenderingStrategy = renderingStrategies[0];
if (!fallbackRenderingStrategy) {
  throw new Error('Rendering strategy registry is empty.');
}
const canvasUnavailableMessageId = 'rendering-strategy-canvas-unavailable-copy';
const folderRequiredReasonId = 'node-types-folder-required-copy';
const collapseSccDisabledReasonId = 'analysis-collapse-scc-disabled-copy';

const relationshipTypes = [...DEFAULT_RELATIONSHIP_TYPES];
const nodeTypes = ['module', 'class', 'interface', 'package'] as const;
const nodeTypeLabels: Record<(typeof nodeTypes)[number], string> = {
  module: 'Module',
  class: 'Class',
  interface: 'Interface',
  package: 'Package',
};

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
const relationshipReasonId = (type: string): string =>
  `relationship-reason-${type.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;

type MemberDisplayMode = 'compact' | 'graph';
const memberDisplayModes: MemberDisplayMode[] = ['compact', 'graph'];

const activeRenderingStrategy = computed<RenderingStrategy>(() => {
  return (
    renderingStrategies.find((s) => s.id === graphSettings.renderingStrategyId) ?? fallbackRenderingStrategy
  );
});

const forcesClusterByFolder = computed(() => activeRenderingStrategy.value.runtime.forcesClusterByFolder);
const clusterByFolderEffective = computed(
  () => graphSettings.clusterByFolder || forcesClusterByFolder.value
);
const isSccDisabled = computed(
  () => graphSettings.clusterByFolder || forcesClusterByFolder.value
);

const isRenderingStrategyDisabled = (strategyId: RenderingStrategyId): boolean => {
  return strategyId === 'canvas' && !props.canvasRendererAvailable;
};

const getEnabledRenderingStrategyIds = (): RenderingStrategyId[] => {
  return renderingStrategies
    .filter((s) => !isRenderingStrategyDisabled(s.id))
    .map((s) => s.id);
};

const firstEnabledRenderingStrategyId = computed<RenderingStrategyId | null>(
  () => getEnabledRenderingStrategyIds()[0] ?? null
);

const getRenderingStrategyTabIndex = (strategyId: RenderingStrategyId): number => {
  if (isRenderingStrategyDisabled(strategyId)) return -1;
  const activeId = graphSettings.renderingStrategyId;
  if (!isRenderingStrategyDisabled(activeId)) return activeId === strategyId ? 0 : -1;
  return firstEnabledRenderingStrategyId.value === strategyId ? 0 : -1;
};

const findAdjacentEnabledStrategyId = (
  currentId: RenderingStrategyId,
  direction: 1 | -1
): RenderingStrategyId | null => {
  const ids = getEnabledRenderingStrategyIds();
  if (ids.length === 0) return null;
  const idx = ids.indexOf(currentId);
  const base = idx >= 0 ? idx : 0;
  const next = (base + direction + ids.length) % ids.length;
  return ids[next] ?? null;
};

const focusRenderingStrategyRadio = (target: EventTarget | null, strategyId: RenderingStrategyId) => {
  if (!(target instanceof HTMLElement)) return;
  const group = target.closest('[role="radiogroup"]');
  const radio = group?.querySelector<HTMLElement>(
    `[role="radio"][data-rendering-strategy-id="${strategyId}"]`
  );
  radio?.focus();
};

const handleRenderingStrategyChange = (strategyId: RenderingStrategyId) => {
  if (isRenderingStrategyDisabled(strategyId)) return;
  emit('rendering-strategy-change', strategyId);
};

const handleRenderingStrategyRadioKeydown = (
  event: KeyboardEvent,
  strategyId: RenderingStrategyId
) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const prev = findAdjacentEnabledStrategyId(strategyId, -1);
    if (prev) {
      handleRenderingStrategyChange(prev);
      focusRenderingStrategyRadio(event.currentTarget, prev);
    }
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    const next = findAdjacentEnabledStrategyId(strategyId, 1);
    if (next) {
      handleRenderingStrategyChange(next);
      focusRenderingStrategyRadio(event.currentTarget, next);
    }
    return;
  }
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    handleRenderingStrategyChange(strategyId);
  }
};

const isRenderingOptionVisible = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition
): boolean =>
  !option.isVisible ||
  option.isVisible({
    strategyId,
    strategyOptionsById: graphSettings.strategyOptionsById,
  });

const isRenderingOptionEnabled = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition
): boolean => {
  if (isRenderingStrategyDisabled(strategyId)) return false;
  return !option.isEnabled || option.isEnabled({ strategyId, strategyOptionsById: graphSettings.strategyOptionsById });
};

const activeRenderingOptions = computed(() => {
  const id = activeRenderingStrategy.value.id;
  return activeRenderingStrategy.value.options.filter((o) => isRenderingOptionVisible(id, o));
});

const getStoredRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition
): unknown => {
  const opts = graphSettings.strategyOptionsById[strategyId] ?? {};
  const v = opts[option.id];
  return v === undefined ? option.defaultValue : v;
};

const getBooleanRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition
): boolean => {
  const v = getStoredRenderingOptionValue(strategyId, option);
  return typeof v === 'boolean' ? v : Boolean(option.defaultValue);
};

const getSelectRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingSelectOptionDefinition
): string => {
  const v = getStoredRenderingOptionValue(strategyId, option);
  return typeof v === 'string' ? v : option.defaultValue;
};

const getNumberRenderingOptionValue = (
  strategyId: RenderingStrategyId,
  option: RenderingNumberOptionDefinition
): number => {
  const v = getStoredRenderingOptionValue(strategyId, option);
  return typeof v === 'number' && Number.isFinite(v) ? v : option.defaultValue;
};

const handleRenderingStrategyOptionChange = (
  strategyId: RenderingStrategyId,
  optionId: string,
  value: RenderingOptionValue
) => {
  emit('rendering-strategy-option-change', { strategyId, optionId, value });
};

const handleBooleanRenderingOptionChange = (
  strategyId: RenderingStrategyId,
  option: RenderingOptionDefinition,
  checked: boolean
) => handleRenderingStrategyOptionChange(strategyId, option.id, checked);

const handleSelectRenderingOptionChange = (
  strategyId: RenderingStrategyId,
  option: RenderingSelectOptionDefinition,
  value: string
) => handleRenderingStrategyOptionChange(strategyId, option.id, value);

const normalizeNumberOptionValue = (
  option: RenderingNumberOptionDefinition,
  raw: string
): number => {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return option.defaultValue;
  let v = n;
  if (typeof option.min === 'number') v = Math.max(option.min, v);
  if (typeof option.max === 'number') v = Math.min(option.max, v);
  return v;
};

const handleNumberRenderingOptionChange = (
  strategyId: RenderingStrategyId,
  option: RenderingNumberOptionDefinition,
  raw: string
) => {
  handleRenderingStrategyOptionChange(strategyId, option.id, normalizeNumberOptionValue(option, raw));
};

const getMemberDisplayTabIndex = (mode: MemberDisplayMode): number =>
  graphSettings.memberNodeMode === mode ? 0 : -1;

const findAdjacentMemberDisplayMode = (
  currentMode: MemberDisplayMode,
  direction: 1 | -1
): MemberDisplayMode => {
  const currentIdx = memberDisplayModes.indexOf(currentMode);
  const baseIdx = currentIdx >= 0 ? currentIdx : 0;
  const nextIdx = (baseIdx + direction + memberDisplayModes.length) % memberDisplayModes.length;
  return memberDisplayModes[nextIdx] ?? currentMode;
};

const focusMemberDisplayRadio = (target: EventTarget | null, mode: MemberDisplayMode) => {
  if (!(target instanceof HTMLElement)) return;
  const group = target.closest('[role="radiogroup"]');
  const radio = group?.querySelector<HTMLElement>(`[role="radio"][data-member-display-mode="${mode}"]`);
  radio?.focus();
};

const handleModuleMemberTypeToggle = (type: ModuleMemberType, checked: boolean) => {
  graphSettings.toggleModuleMemberType(type, checked);
};

const toggleListItem = (values: string[], value: string, enabled: boolean): string[] =>
  enabled ? (values.includes(value) ? values : [...values, value]) : values.filter((x) => x !== value);

const handleRelationshipFilterChange = (type: string, checked: boolean) => {
  if (isRelationshipDisabled(type)) return;
  emit('relationship-filter-change', toggleListItem(graphSettings.enabledRelationshipTypes, type, checked));
};

const handleNodeTypeFilterChange = (type: (typeof nodeTypes)[number], checked: boolean) => {
  emit('node-type-filter-change', toggleListItem(graphSettings.enabledNodeTypes, type, checked));
};

const handleCollapseSccToggle = (checked: boolean) => emit('toggle-collapse-scc', checked);
const handleClusterByFolderToggle = (checked: boolean) => emit('toggle-cluster-folder', checked);
const handleHideTestFilesToggle = (checked: boolean) => emit('toggle-hide-test-files', checked);
const handleMemberNodeModeChange = (mode: MemberDisplayMode) => emit('member-node-mode-change', mode);
const handleOrphanGlobalToggle = (checked: boolean) => emit('toggle-orphan-global', checked);
const handleShowFpsToggle = (checked: boolean) => emit('toggle-show-fps', checked);
const handleFpsAdvancedToggle = (checked: boolean) => emit('toggle-fps-advanced', checked);

const handleMemberDisplayModeKeydown = (event: KeyboardEvent, mode: MemberDisplayMode) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const prev = findAdjacentMemberDisplayMode(mode, -1);
    handleMemberNodeModeChange(prev);
    focusMemberDisplayRadio(event.currentTarget, prev);
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    const next = findAdjacentMemberDisplayMode(mode, 1);
    handleMemberNodeModeChange(next);
    focusMemberDisplayRadio(event.currentTarget, next);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    handleMemberNodeModeChange(mode);
  }
};

const onSearchQueryUpdate = (v: string) => {
  if (props.graphSearchContext) props.graphSearchContext.searchQuery.value = v;
};

const searchQueryValue = computed(
  () => props.graphSearchContext?.searchQuery?.value ?? ''
);

const activeCollisionConfig = computed(() =>
  getActiveCollisionConfig(graphSettings.renderingStrategyId, graphSettings.strategyOptionsById)
);
const activeMinimumDistance = computed(() => activeCollisionConfig.value.overlapGap);
</script>

<template>
  <Panel position="top-left">
    <div class="graph-controls-shell bg-background-paper p-5 rounded-lg border border-border-default shadow-xl">
      <div v-if="graphSearchContext" class="mb-4 border-b border-border-default pb-4">
        <GraphSearch
          :model-value="searchQueryValue"
          :run-search="graphSearchContext.runSearch"
          @update:model-value="onSearchQueryUpdate"
        />
      </div>

      <div class="section-collapse">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('nodeTypes')"
          :aria-controls="'section-nodeTypes'"
          @click="toggleSection('nodeTypes')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'nodeTypes')"
        >
          <span class="section-label">Node Types</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('nodeTypes') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('nodeTypes')"
          :id="'section-nodeTypes'"
          class="section-content"
        >
          <fieldset class="control-fieldset">
            <legend class="sr-only">Node type filters</legend>
            <div class="control-group">
              <label
                v-for="nodeType in nodeTypes"
                :key="nodeType"
                class="control-row control-row-interactive"
              >
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.enabledNodeTypes.includes(nodeType)"
                  @change="(e) => handleNodeTypeFilterChange(nodeType, (e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">{{ nodeTypeLabels[nodeType] }}</span>
              </label>
              <label
                class="control-row"
                :class="clusterByFolderEffective ? 'control-row-disabled' : 'control-row-interactive'"
              >
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="clusterByFolderEffective"
                  :disabled="forcesClusterByFolder"
                  :aria-disabled="forcesClusterByFolder"
                  :aria-describedby="forcesClusterByFolder ? folderRequiredReasonId : undefined"
                  @change="(e) => !forcesClusterByFolder && handleClusterByFolderToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Folder</span>
              </label>
            </div>
          </fieldset>
          <p
            v-if="forcesClusterByFolder"
            :id="folderRequiredReasonId"
            class="section-helper ml-6 mt-1"
          >
            Required by Folder View strategy.
          </p>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('renderingStrategy')"
          :aria-controls="'section-renderingStrategy'"
          @click="toggleSection('renderingStrategy')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'renderingStrategy')"
        >
          <span class="section-label">Rendering Strategy</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('renderingStrategy') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('renderingStrategy')"
          :id="'section-renderingStrategy'"
          class="section-content"
        >
          <p class="section-description">
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
                'strategy-radio',
                graphSettings.renderingStrategyId === strategy.id ? 'strategy-radio-active' : 'strategy-radio-inactive',
                isRenderingStrategyDisabled(strategy.id) ? 'strategy-radio-disabled' : '',
              ]"
              @click="handleRenderingStrategyChange(strategy.id)"
              @keydown="(e) => handleRenderingStrategyRadioKeydown(e, strategy.id)"
            >
              <div class="text-xs font-semibold leading-tight">{{ strategy.label }}</div>
              <div class="mt-1 text-[11px] leading-tight text-text-secondary">{{ strategy.description }}</div>
            </button>
          </div>
          <p
            v-if="!props.canvasRendererAvailable"
            :id="canvasUnavailableMessageId"
            class="section-helper mt-2"
          >
            Canvas strategy is unavailable in this browser session.
          </p>
          <div v-if="activeRenderingOptions.length > 0" class="mt-3 space-y-2" aria-live="polite" aria-atomic="false">
            <h5 class="text-xs font-semibold text-text-primary">{{ activeRenderingStrategy.label }} options</h5>
            <div
              v-for="option in activeRenderingOptions"
              :key="`${activeRenderingStrategy.id}-${option.id}`"
              class="option-card"
            >
              <label
                :for="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
                class="block text-xs font-medium text-text-primary"
              >
                {{ option.label }}
              </label>
              <p class="option-description">{{ option.description }}</p>
              <input
                v-if="option.type === 'boolean'"
                :id="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
                type="checkbox"
                class="control-checkbox"
                :checked="getBooleanRenderingOptionValue(activeRenderingStrategy.id, option)"
                :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
                :aria-disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
                @change="
                  (e) =>
                    handleBooleanRenderingOptionChange(
                      activeRenderingStrategy.id,
                      option,
                      (e.target as HTMLInputElement).checked
                    )
                "
              />
              <select
                v-else-if="option.type === 'select'"
                :id="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
                class="option-select"
                :value="getSelectRenderingOptionValue(activeRenderingStrategy.id, option)"
                :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
                :aria-disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
                @change="
                  (e) =>
                    handleSelectRenderingOptionChange(
                      activeRenderingStrategy.id,
                      option,
                      (e.target as HTMLSelectElement).value
                    )
                "
              >
                <option
                  v-for="selectOption in option.options"
                  :key="selectOption.value"
                  :value="selectOption.value"
                >
                  {{ selectOption.label }}
                </option>
              </select>
              <div v-else class="flex items-center gap-2">
                <input
                  :id="`rendering-option-${activeRenderingStrategy.id}-${option.id}`"
                  type="range"
                  class="option-range"
                  :min="option.min"
                  :max="option.max"
                  :step="option.step ?? 1"
                  :value="getNumberRenderingOptionValue(activeRenderingStrategy.id, option)"
                  :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
                  :aria-disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
                  :aria-valuemin="typeof option.min === 'number' ? option.min : undefined"
                  :aria-valuemax="typeof option.max === 'number' ? option.max : undefined"
                  :aria-valuenow="getNumberRenderingOptionValue(activeRenderingStrategy.id, option)"
                  :aria-valuetext="String(getNumberRenderingOptionValue(activeRenderingStrategy.id, option))"
                  @input="
                    (e) =>
                      handleNumberRenderingOptionChange(
                        activeRenderingStrategy.id,
                        option,
                        (e.target as HTMLInputElement).value
                      )
                  "
                />
                <span class="w-8 text-right text-xs tabular-nums text-text-secondary">
                  {{ getNumberRenderingOptionValue(activeRenderingStrategy.id, option) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('analysis')"
          :aria-controls="'section-analysis'"
          @click="toggleSection('analysis')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'analysis')"
        >
          <span class="section-label">Analysis</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('analysis') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('analysis')"
          :id="'section-analysis'"
          class="section-content"
        >
          <fieldset class="control-fieldset">
            <legend class="sr-only">Analysis options</legend>
            <div class="control-group">
              <label class="control-row" :class="isSccDisabled ? 'control-row-disabled' : 'control-row-interactive'">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.collapseScc"
                  :disabled="isSccDisabled"
                  :aria-disabled="isSccDisabled"
                  :aria-describedby="isSccDisabled ? collapseSccDisabledReasonId : undefined"
                  @change="(e) => handleCollapseSccToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Collapse cycles (SCC)</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.hideTestFiles"
                  @change="(e) => handleHideTestFilesToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Hide test files</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.highlightOrphanGlobal"
                  @change="(e) => handleOrphanGlobalToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Highlight global orphans</span>
              </label>
            </div>
          </fieldset>
          <p v-if="isSccDisabled" :id="collapseSccDisabledReasonId" class="section-helper ml-6 mt-1">
            Unavailable while folder clustering is active.
          </p>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('moduleSections')"
          :aria-controls="'section-moduleSections'"
          @click="toggleSection('moduleSections')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'moduleSections')"
        >
          <span class="section-label">Module Sections</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('moduleSections') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('moduleSections')"
          :id="'section-moduleSections'"
          class="section-content"
        >
          <p class="section-description">
            Toggle which entity types are shown inside module nodes.
          </p>
          <fieldset class="control-fieldset">
            <legend class="sr-only">Module entity type visibility</legend>
            <div class="control-group">
              <label
                v-for="memberType in moduleMemberTypes"
                :key="memberType"
                class="control-row control-row-interactive"
              >
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.enabledModuleMemberTypes.includes(memberType)"
                  @change="(e) => handleModuleMemberTypeToggle(memberType, (e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">{{ moduleMemberLabels[memberType] }}</span>
              </label>
            </div>
          </fieldset>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('memberDisplay')"
          :aria-controls="'section-memberDisplay'"
          @click="toggleSection('memberDisplay')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'memberDisplay')"
        >
          <span class="section-label">Member Display</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('memberDisplay') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('memberDisplay')"
          :id="'section-memberDisplay'"
          class="section-content"
        >
          <p class="section-description">
            How properties and methods render within class/interface nodes.
          </p>
          <div role="radiogroup" aria-label="Member display mode" class="grid grid-cols-2 gap-2">
            <button
              type="button"
              role="radio"
              data-member-display-mode="compact"
              :aria-checked="graphSettings.memberNodeMode === 'compact'"
              :tabindex="getMemberDisplayTabIndex('compact')"
              :class="[
                'strategy-radio member-mode-radio',
                graphSettings.memberNodeMode === 'compact' ? 'strategy-radio-active' : 'strategy-radio-inactive',
              ]"
              @click="handleMemberNodeModeChange('compact')"
              @keydown="(e) => handleMemberDisplayModeKeydown(e, 'compact')"
            >
              Compact
            </button>
            <button
              type="button"
              role="radio"
              data-member-display-mode="graph"
              :aria-checked="graphSettings.memberNodeMode === 'graph'"
              :tabindex="getMemberDisplayTabIndex('graph')"
              :class="[
                'strategy-radio member-mode-radio',
                graphSettings.memberNodeMode === 'graph' ? 'strategy-radio-active' : 'strategy-radio-inactive',
              ]"
              @click="handleMemberNodeModeChange('graph')"
              @keydown="(e) => handleMemberDisplayModeKeydown(e, 'graph')"
            >
              Separate Nodes
            </button>
          </div>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('relationshipTypes')"
          :aria-controls="'section-relationshipTypes'"
          @click="toggleSection('relationshipTypes')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'relationshipTypes')"
        >
          <span class="section-label">Relationship Types</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('relationshipTypes') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('relationshipTypes')"
          :id="'section-relationshipTypes'"
          class="section-content"
        >
          <fieldset class="control-fieldset">
            <legend class="sr-only">Relationship visibility filters</legend>
            <div class="control-group">
              <div v-for="type in relationshipTypes" :key="type" class="space-y-1">
                <label class="control-row" :class="isRelationshipDisabled(type) ? 'control-row-disabled' : 'control-row-interactive'">
                  <input
                    type="checkbox"
                    class="control-checkbox"
                    :checked="graphSettings.enabledRelationshipTypes.includes(type)"
                    :disabled="isRelationshipDisabled(type)"
                    :aria-disabled="isRelationshipDisabled(type)"
                    :aria-describedby="isRelationshipDisabled(type) ? relationshipReasonId(type) : undefined"
                    @change="(e) => handleRelationshipFilterChange(type, (e.target as HTMLInputElement).checked)"
                  />
                  <span class="control-label capitalize">{{ type }}</span>
                </label>
                <p v-if="isRelationshipDisabled(type)" :id="relationshipReasonId(type)" class="section-helper ml-6">
                  {{ relationshipReason(type) }}
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('performance')"
          :aria-controls="'section-performance'"
          @click="toggleSection('performance')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'performance')"
        >
          <span class="section-label">Performance</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('performance') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('performance')"
          :id="'section-performance'"
          class="section-content"
        >
          <fieldset class="control-fieldset">
            <legend class="sr-only">Performance options</legend>
            <div class="control-group">
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showFps"
                  @change="(e) => handleShowFpsToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show FPS</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showFpsAdvanced"
                  @change="(e) => handleFpsAdvancedToggle((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Advanced</span>
              </label>
            </div>
          </fieldset>
        </div>
      </div>

      <div class="section-collapse section-divider">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!isSectionCollapsed('debug')"
          :aria-controls="'section-debug'"
          @click="toggleSection('debug')"
          @keydown="(e) => onSectionHeaderKeydown(e, 'debug')"
        >
          <span class="section-label">Debug</span>
          <span class="section-chevron" aria-hidden="true">{{ isSectionCollapsed('debug') ? '▸' : '▾' }}</span>
        </button>
        <div
          v-show="!isSectionCollapsed('debug')"
          :id="'section-debug'"
          class="section-content"
        >
          <fieldset class="control-fieldset">
            <legend class="sr-only">Debug rendering options</legend>
            <div class="control-group">
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showDebugBounds"
                  @change="(e) => graphSettings.setShowDebugBounds((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show collision bounds</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showDebugHandles"
                  @change="(e) => graphSettings.setShowDebugHandles((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show handles</span>
              </label>
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showDebugNodeIds"
                  @change="(e) => graphSettings.setShowDebugNodeIds((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show node IDs</span>
              </label>
              <div class="debug-summary">
                <div>Strategy: {{ graphSettings.renderingStrategyId }}</div>
                <div>Minimum distance: {{ activeMinimumDistance }}px</div>
                <div>Overlap gap: {{ activeCollisionConfig.overlapGap }}px</div>
              </div>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.graph-controls-shell {
  width: min(24rem, calc(100vw - 1.5rem));
  max-height: calc(100vh - 1.5rem);
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
}

.graph-controls-shell::-webkit-scrollbar {
  width: 0.5rem;
}

.graph-controls-shell::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
}

.graph-controls-shell::-webkit-scrollbar-track {
  background: transparent;
}

.section-collapse {
  margin: 0;
}

.section-divider {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(var(--border-default-rgb, 64, 64, 64), 0.7);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 2rem;
  margin: 0;
  padding: 0.4rem 0.45rem;
  background: none;
  border: none;
  border-radius: 0.4rem;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 150ms ease-out,
    color 150ms ease-out;
}

.section-header:hover {
  color: var(--color-text-primary, currentColor);
  background: rgba(255, 255, 255, 0.06);
}

.section-header:focus-visible {
  outline: 2px solid var(--focus-ring, #00ffff);
  outline-offset: 2px;
}

.section-label {
  font-size: 0.84rem;
  font-weight: 650;
  color: var(--color-text-primary, currentColor);
  letter-spacing: 0.01em;
}

.section-chevron {
  font-size: 0.68rem;
  opacity: 0.9;
}

.section-content {
  padding: 0.45rem 0.45rem 0;
}

.section-description {
  margin-bottom: 0.55rem;
  font-size: 0.72rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.section-helper {
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-secondary);
}

.control-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 1.65rem;
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--color-text-secondary);
  transition: color 150ms ease-out;
}

.control-row-interactive {
  cursor: pointer;
}

.control-row-interactive:hover {
  color: var(--color-text-primary);
}

.control-row-disabled {
  cursor: not-allowed;
  color: var(--color-text-muted);
}

.control-label {
  font-size: 0.75rem;
  line-height: 1.3;
}

.control-checkbox {
  width: 1rem;
  height: 1rem;
  min-width: 1rem;
  min-height: 1rem;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--color-primary-main);
}

.control-checkbox:disabled {
  cursor: not-allowed;
}

.control-checkbox:focus-visible {
  outline: 2px solid var(--focus-ring, #00ffff);
  outline-offset: 2px;
}

.strategy-radio {
  width: 100%;
  border-radius: 0.45rem;
  border: 1px solid var(--color-border-default);
  padding: 0.58rem 0.65rem;
  text-align: left;
  transition:
    border-color 150ms ease-out,
    background-color 150ms ease-out,
    color 150ms ease-out,
    box-shadow 150ms ease-out;
}

.strategy-radio-inactive {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.strategy-radio-inactive:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.15);
}

.strategy-radio-active {
  color: var(--color-text-primary);
  border-color: var(--color-primary-main);
  background: rgba(144, 202, 249, 0.2);
  box-shadow: 0 0 0 1px rgba(144, 202, 249, 0.2);
}

.strategy-radio-disabled {
  cursor: not-allowed;
  color: var(--color-text-muted);
  border-color: rgba(var(--border-default-rgb, 64, 64, 64), 0.6);
  background: rgba(255, 255, 255, 0.04);
}

.strategy-radio:focus-visible {
  outline: 2px solid var(--focus-ring, #00ffff);
  outline-offset: 2px;
}

.member-mode-radio {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 650;
}

.option-card {
  border-radius: 0.45rem;
  border: 1px solid rgba(var(--border-default-rgb, 64, 64, 64), 0.72);
  background: rgba(255, 255, 255, 0.09);
  padding: 0.55rem 0.6rem;
}

.option-description {
  margin-bottom: 0.5rem;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-secondary);
}

.option-select {
  width: 100%;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border-default);
  background: var(--color-background-paper);
  color: var(--color-text-primary);
  font-size: 0.75rem;
  line-height: 1.3;
  padding: 0.3rem 0.5rem;
}

.option-select:focus-visible {
  outline: 2px solid var(--focus-ring, #00ffff);
  outline-offset: 2px;
  border-color: var(--color-primary-main);
}

.option-range {
  flex: 1;
  cursor: pointer;
  accent-color: var(--color-primary-main);
}

.option-range:disabled {
  cursor: not-allowed;
}

.option-range:focus-visible {
  outline: 2px solid var(--focus-ring, #00ffff);
  outline-offset: 2px;
}

.debug-summary {
  border-radius: 0.45rem;
  border: 1px solid rgba(var(--border-default-rgb, 64, 64, 64), 0.72);
  background: rgba(255, 255, 255, 0.09);
  padding: 0.5rem 0.6rem;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-secondary);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
