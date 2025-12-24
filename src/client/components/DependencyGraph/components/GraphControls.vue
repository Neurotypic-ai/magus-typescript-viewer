<script setup lang="ts">
import { Panel, useVueFlow } from '@vue-flow/core';
import { ref } from 'vue';

const emit = defineEmits<{
  'relationship-filter-change': [types: string[]];
  'reset-layout': [];
  'layout-change': [config: { algorithm?: string; direction?: string; nodeSpacing?: number; rankSpacing?: number }];
  'toggle-collapse-scc': [value: boolean];
  'toggle-cluster-folder': [value: boolean];
}>();

const { zoomIn, zoomOut, fitView } = useVueFlow();

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
  emit('reset-layout');
};

// Relationship types matching the actual edge data types (lowercase)
const relationshipTypes = [
  'import',
  'export',
  'inheritance',
  'implements',
  'contains',
  'dependency',
  'devDependency',
  'peerDependency',
];

// Track which types are currently enabled (all enabled by default)
const enabledTypes = ref<string[]>([...relationshipTypes]);

const handleFilterChange = (type: string, checked: boolean) => {
  if (checked) {
    enabledTypes.value = [...enabledTypes.value, type];
  } else {
    enabledTypes.value = enabledTypes.value.filter((t) => t !== type);
  }
  emit('relationship-filter-change', enabledTypes.value);
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
              @change="(e) => emit('toggle-collapse-scc', (e.target as HTMLInputElement).checked)"
              checked
            />
            <span class="text-xs">Collapse cycles (SCC)</span>
          </label>
          <label
            class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-fast"
          >
            <input
              type="checkbox"
              class="cursor-pointer accent-primary-main"
              @change="(e) => emit('toggle-cluster-folder', (e.target as HTMLInputElement).checked)"
            />
            <span class="text-xs">Cluster by folder</span>
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
              :checked="enabledTypes.includes(type)"
              @change="(e) => handleFilterChange(type, (e.target as HTMLInputElement).checked)"
              class="cursor-pointer accent-primary-main"
            />
            <span class="text-xs capitalize">{{ type }}</span>
          </label>
        </div>
      </div>
    </div>
  </Panel>
</template>
