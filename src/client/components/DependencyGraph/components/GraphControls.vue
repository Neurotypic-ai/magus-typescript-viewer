<script setup lang="ts">
import { Panel, useVueFlow } from '@vue-flow/core';
import { ref } from 'vue';

import { DEFAULT_RELATIONSHIP_TYPES, useGraphSettings } from '../../../stores/graphSettings';

const emit = defineEmits<{
  'relationship-filter-change': [types: string[]];
  'node-type-filter-change': [types: string[]];
  'reset-layout': [];
  'layout-change': [config: { algorithm?: string; direction?: string; nodeSpacing?: number; rankSpacing?: number }];
  'toggle-collapse-scc': [value: boolean];
  'toggle-cluster-folder': [value: boolean];
}>();

const { zoomIn, zoomOut, fitView } = useVueFlow();
const graphSettings = useGraphSettings();

// Layout configuration
const layoutAlgorithm = ref<'layered' | 'radial' | 'force' | 'stress'>('layered');
const layoutDirection = ref<'LR' | 'RL' | 'TB' | 'BT'>('LR');
const nodeSpacing = ref(100);
const rankSpacing = ref(150);

const handleZoomIn = () => {
  void zoomIn({ duration: 150 });
};

const handleZoomOut = () => {
  void zoomOut({ duration: 150 });
};

const handleFitView = () => {
  void fitView({ duration: 150, padding: 0.1 });
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

const handleRelationshipFilterChange = (type: string, checked: boolean) => {
  graphSettings.toggleRelationshipType(type as (typeof DEFAULT_RELATIONSHIP_TYPES)[number], checked);
  emit('relationship-filter-change', [...graphSettings.enabledRelationshipTypes]);
};

const handleNodeTypeFilterChange = (type: (typeof nodeTypes)[number], checked: boolean) => {
  graphSettings.toggleNodeType(type, checked);
  emit('node-type-filter-change', [...graphSettings.enabledNodeTypes]);
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
  graphSettings.setCollapseScc(checked);
  emit('toggle-collapse-scc', checked);
};

const handleClusterByFolderToggle = (checked: boolean) => {
  if (checked && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
    emit('toggle-collapse-scc', false);
  }
  graphSettings.setClusterByFolder(checked);
  emit('toggle-cluster-folder', checked);
};
</script>

<template>
  <Panel position="top-left">
    <div class="bg-background-paper p-4 rounded-lg border border-border-default shadow-xl">
      <!-- Button Group -->
      <div class="flex gap-2 mb-4">
        <button
          @click="handleZoomIn"
          class="px-3 py-1.5 bg-white/10 text-text-primary rounded hover:bg-white/20 transition-fast border border-border-default font-semibold"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          @click="handleZoomOut"
          class="px-3 py-1.5 bg-white/10 text-text-primary rounded hover:bg-white/20 transition-fast border border-border-default font-semibold"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          @click="handleFitView"
          class="px-3 py-1.5 bg-white/10 text-text-primary rounded hover:bg-white/20 transition-fast border border-border-default text-xs font-semibold"
          aria-label="Fit view to content"
        >
          Fit
        </button>
        <button
          @click="handleResetLayout"
          class="px-3 py-1.5 bg-white/10 text-text-primary rounded hover:bg-white/20 transition-fast border border-border-default text-xs font-semibold"
          aria-label="Reset layout"
        >
          Reset
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

      <!-- Filter Panel -->
      <div class="mt-4 pt-4 border-t border-border-default">
        <h4 class="text-sm font-semibold text-text-primary mb-2">Relationship Types</h4>
        <div class="flex flex-col gap-1.5">
          <label
            v-for="type in relationshipTypes"
            :key="type"
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              :checked="graphSettings.enabledRelationshipTypes.includes(type)"
              @change="(e) => handleRelationshipFilterChange(type, (e.target as HTMLInputElement).checked)"
              class="cursor-pointer accent-primary-main"
            />
            <span class="text-xs capitalize">{{ type }}</span>
          </label>
        </div>
      </div>
    </div>
  </Panel>
</template>
