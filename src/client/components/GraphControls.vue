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
const handleMemberNodeModeChange = (mode: 'compact' | 'graph') => emit('member-node-mode-change', mode);
const handleOrphanGlobalToggle = (checked: boolean) => emit('toggle-orphan-global', checked);
const handleShowFpsToggle = (checked: boolean) => emit('toggle-show-fps', checked);
const handleFpsAdvancedToggle = (checked: boolean) => emit('toggle-fps-advanced', checked);

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
    <div class="bg-background-paper p-4 rounded-lg border border-border-default shadow-xl">
      <!-- Search Nodes (embedded at top) -->
      <div v-if="graphSearchContext" class="mb-4">
        <GraphSearch
          :model-value="searchQueryValue"
          :run-search="graphSearchContext.runSearch"
          @update:model-value="onSearchQueryUpdate"
        />
      </div>

      <!-- Node Types -->
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
          class="section-content pt-2"
        >
          <div class="flex flex-col gap-1.5">
            <label
              v-for="nodeType in nodeTypes"
              :key="nodeType"
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.enabledNodeTypes.includes(nodeType)"
                :aria-label="`Show ${nodeType} nodes`"
                @change="(e) => handleNodeTypeFilterChange(nodeType, (e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">{{ nodeTypeLabels[nodeType] }}</span>
            </label>
            <label
              class="flex items-center gap-2 text-sm text-text-secondary transition-fast mt-1"
              :class="clusterByFolderEffective ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:text-text-primary'"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="clusterByFolderEffective"
                :disabled="forcesClusterByFolder"
                :aria-label="forcesClusterByFolder ? 'Folder nodes (required by Folder View)' : 'Show folder nodes'"
                @change="(e) => !forcesClusterByFolder && handleClusterByFolderToggle((e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">Folder</span>
            </label>
            <p
              v-if="forcesClusterByFolder"
              class="text-[10px] text-text-muted mt-0.5 ml-5"
            >
              Required by Folder View strategy.
            </p>
          </div>
        </div>
      </div>

      <!-- Rendering Strategy -->
      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
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
              @keydown="(e) => handleRenderingStrategyRadioKeydown(e, strategy.id)"
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
                class="w-full rounded border border-border-default bg-background-paper px-2 py-1 text-xs text-text-primary"
                :value="getSelectRenderingOptionValue(activeRenderingStrategy.id, option)"
                :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
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
                  class="flex-1 accent-primary-main cursor-pointer"
                  :min="option.min"
                  :max="option.max"
                  :step="option.step ?? 1"
                  :value="getNumberRenderingOptionValue(activeRenderingStrategy.id, option)"
                  :disabled="!isRenderingOptionEnabled(activeRenderingStrategy.id, option)"
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

      <!-- Analysis -->
      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
          <div class="flex flex-col gap-2">
            <label
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.collapseScc"
                :disabled="isSccDisabled"
                :aria-label="
                  isSccDisabled
                    ? 'Collapse cycles (SCC) unavailable when clustering by folder'
                    : 'Collapse cycles (SCC)'
                "
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
                :checked="graphSettings.hideTestFiles"
                aria-label="Hide test files"
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
                aria-label="Highlight global orphans"
                @change="(e) => handleOrphanGlobalToggle((e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">Highlight global orphans</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Module Sections -->
      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
          <p class="text-[10px] text-text-secondary mb-2 leading-tight">
            Toggle which entity types are shown inside module nodes
          </p>
          <div class="flex flex-col gap-1.5">
            <label
              v-for="memberType in moduleMemberTypes"
              :key="memberType"
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.enabledModuleMemberTypes.includes(memberType)"
                :aria-label="`Show ${moduleMemberLabels[memberType]}`"
                @change="(e) => handleModuleMemberTypeToggle(memberType, (e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">{{ moduleMemberLabels[memberType] }}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Member Display -->
      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
          <p class="text-[10px] text-text-secondary mb-2 leading-tight">
            How properties and methods render within class/interface nodes
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :class="[
                'px-2 py-1.5 text-xs rounded border transition-fast',
                graphSettings.memberNodeMode === 'compact'
                  ? 'bg-primary-main text-white border-primary-main'
                  : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
              ]"
              aria-label="Set member display mode to compact"
              @click="handleMemberNodeModeChange('compact')"
            >
              Compact
            </button>
            <button
              type="button"
              :class="[
                'px-2 py-1.5 text-xs rounded border transition-fast',
                graphSettings.memberNodeMode === 'graph'
                  ? 'bg-primary-main text-white border-primary-main'
                  : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
              ]"
              aria-label="Set member display mode to separate nodes"
              @click="handleMemberNodeModeChange('graph')"
            >
              Separate Nodes
            </button>
          </div>
        </div>
      </div>

      <!-- Relationship Types -->
      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
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
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.enabledRelationshipTypes.includes(type)"
                :disabled="isRelationshipDisabled(type)"
                :aria-label="`${type} relationships`"
                @change="(e) => handleRelationshipFilterChange(type, (e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs capitalize">
                {{ type }}
                <span v-if="isRelationshipDisabled(type)" class="text-text-muted">
                  ({{ relationshipReason(type) }})
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <!-- Performance -->
      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
          <div class="flex flex-col gap-2">
            <label
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.showFps"
                aria-label="Show FPS"
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
                aria-label="FPS advanced stats"
                @change="(e) => handleFpsAdvancedToggle((e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">Advanced</span>
            </label>
          </div>
        </div>
      </div>

      <div class="section-collapse mt-4 pt-4 border-t border-border-default">
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
          class="section-content pt-2"
        >
          <div class="flex flex-col gap-2">
            <label
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.showDebugBounds"
                aria-label="Show debug collision bounds"
                @change="(e) => graphSettings.setShowDebugBounds((e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">Show collision bounds</span>
            </label>
            <label
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.showDebugHandles"
                aria-label="Show debug handle anchors"
                @change="(e) => graphSettings.setShowDebugHandles((e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">Show handles</span>
            </label>
            <label
              class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
            >
              <input
                type="checkbox"
                class="cursor-pointer accent-primary-main"
                :checked="graphSettings.showDebugNodeIds"
                aria-label="Show debug node ids"
                @change="(e) => graphSettings.setShowDebugNodeIds((e.target as HTMLInputElement).checked)"
              />
              <span class="text-xs">Show node IDs</span>
            </label>
            <div class="rounded border border-border-default bg-white/5 px-2 py-2 text-[10px] text-text-secondary leading-tight">
              <div>Strategy: {{ graphSettings.renderingStrategyId }}</div>
              <div>Minimum distance: {{ activeMinimumDistance }}px</div>
              <div>Overlap gap: {{ activeCollisionConfig.overlapGap }}px</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.section-collapse {
  margin: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  margin: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.section-header:hover {
  color: var(--color-text-primary, currentColor);
}

.section-header:focus-visible {
  outline: 2px solid var(--color-border-focus, #22d3ee);
  outline-offset: 2px;
}

.section-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.section-chevron {
  font-size: 0.65rem;
  opacity: 0.9;
}
</style>
