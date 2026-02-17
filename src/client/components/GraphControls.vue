<script setup lang="ts">
import { Panel } from '@vue-flow/core';
import { ref } from 'vue';

import { DEFAULT_MODULE_MEMBER_TYPES, DEFAULT_RELATIONSHIP_TYPES, useGraphSettings } from '../stores/graphSettings';

import type { EdgeRendererMode, ModuleMemberType } from '../stores/graphSettings';

interface GraphControlsProps {
  relationshipAvailability?: Record<string, { available: boolean; reason?: string }>;
  hybridCanvasAvailable?: boolean;
}

const props = withDefaults(defineProps<GraphControlsProps>(), {
  relationshipAvailability: () => ({}),
  hybridCanvasAvailable: true,
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
  'edge-renderer-mode-change': [value: EdgeRendererMode];
}>();

const graphSettings = useGraphSettings();

// Layout configuration
const layoutAlgorithm = ref<'layered' | 'radial' | 'force' | 'stress'>('layered');
const layoutDirection = ref<'LR' | 'RL' | 'TB' | 'BT'>('LR');
const nodeSpacing = ref(100);
const rankSpacing = ref(150);

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

const handleModuleMemberTypeToggle = (type: ModuleMemberType, checked: boolean) => {
  graphSettings.toggleModuleMemberType(type, checked);
};

const getRelationshipAvailability = (type: string) => props.relationshipAvailability[type] ?? { available: true };
const isRelationshipDisabled = (type: string) => !getRelationshipAvailability(type).available;
const relationshipReason = (type: string) => getRelationshipAvailability(type).reason ?? 'Unavailable';

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

const handleEdgeRendererModeChange = (mode: EdgeRendererMode) => {
  emit('edge-renderer-mode-change', mode);
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

      <!-- Degree-Weighted Layers (layered algorithm only) -->
      <div v-if="layoutAlgorithm === 'layered'" class="mt-3">
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

      <!-- Edge Renderer -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-1">Edge Renderer</h4>
        <p class="text-[10px] text-text-secondary mb-2 leading-tight">Switch between hybrid canvas and Vue Flow SVG edges</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            @click="handleEdgeRendererModeChange('hybrid-canvas')"
            :disabled="!props.hybridCanvasAvailable"
            :class="[
              'px-2 py-1.5 text-xs rounded border transition-fast',
              graphSettings.edgeRendererMode === 'hybrid-canvas'
                ? 'bg-primary-main text-white border-primary-main'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
              !props.hybridCanvasAvailable ? 'opacity-50 cursor-not-allowed hover:bg-white/10' : '',
            ]"
            aria-label="Set edge renderer mode to hybrid canvas"
          >
            Hybrid
          </button>
          <button
            @click="handleEdgeRendererModeChange('vue-flow')"
            :class="[
              'px-2 py-1.5 text-xs rounded border transition-fast',
              graphSettings.edgeRendererMode === 'vue-flow'
                ? 'bg-primary-main text-white border-primary-main'
                : 'bg-white/10 text-text-primary border-border-default hover:bg-white/20',
            ]"
            aria-label="Set edge renderer mode to Vue Flow"
          >
            Vue Flow
          </button>
        </div>
        <p v-if="!props.hybridCanvasAvailable" class="text-[10px] text-text-muted mt-2 leading-tight">
          Hybrid canvas is unavailable in this browser session.
        </p>
      </div>

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
