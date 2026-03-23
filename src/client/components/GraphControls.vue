<script setup lang="ts">
import { computed } from 'vue';

import { Panel } from '@vue-flow/core';

import { DEFAULT_RELATIONSHIP_TYPES, useGraphSettings } from '../stores/graphSettings';
import GraphSearch from './GraphSearch.vue';

import type { Ref } from 'vue';

interface GraphSearchContext {
  searchQuery: Ref<string>;
  runSearch: () => void;
  clearSearch?: () => void;
}

interface GraphControlsProps {
  relationshipAvailability?: Record<string, { available: boolean; reason?: string }>;
  graphSearchContext?: GraphSearchContext | null;
}

const props = withDefaults(defineProps<GraphControlsProps>(), {
  relationshipAvailability: () => ({}),
  graphSearchContext: null,
});

const emit = defineEmits<{
  'relationship-filter-change': [types: string[]];
  'toggle-hide-test-files': [value: boolean];
  'toggle-orphan-global': [value: boolean];
  'toggle-show-fps': [value: boolean];
  'toggle-fps-advanced': [value: boolean];
}>();

const graphSettings = useGraphSettings();

const relationshipTypes = [...DEFAULT_RELATIONSHIP_TYPES];

const getRelationshipAvailability = (type: string) => props.relationshipAvailability[type] ?? { available: true };
const isRelationshipDisabled = (type: string) => !getRelationshipAvailability(type).available;
const relationshipReason = (type: string) => getRelationshipAvailability(type).reason ?? 'Unavailable';
const relationshipReasonId = (type: string): string =>
  `relationship-reason-${type.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;

const toggleListItem = (values: string[], value: string, enabled: boolean): string[] =>
  enabled ? (values.includes(value) ? values : [...values, value]) : values.filter((x) => x !== value);

const handleRelationshipFilterChange = (type: string, checked: boolean) => {
  if (isRelationshipDisabled(type)) return;
  emit('relationship-filter-change', toggleListItem(graphSettings.enabledRelationshipTypes, type, checked));
};

const handleHideTestFilesToggle = (checked: boolean) => {
  emit('toggle-hide-test-files', checked);
};
const handleOrphanGlobalToggle = (checked: boolean) => {
  emit('toggle-orphan-global', checked);
};
const handleShowFpsToggle = (checked: boolean) => {
  emit('toggle-show-fps', checked);
};
const handleFpsAdvancedToggle = (checked: boolean) => {
  emit('toggle-fps-advanced', checked);
};

const onSearchQueryUpdate = (v: string) => {
  if (props.graphSearchContext) {
    props.graphSearchContext.searchQuery.value = v;
  }
};

const searchQueryValue = computed(() => props.graphSearchContext?.searchQuery.value ?? '');
</script>

<template>
  <Panel v-if="graphSearchContext" position="top-left" class="graph-search-panel">
    <div class="graph-search-shell bg-background-paper rounded-lg border border-border-default shadow-xl">
      <GraphSearch
        :model-value="searchQueryValue"
        :run-search="graphSearchContext.runSearch"
        @update:model-value="onSearchQueryUpdate"
      />
    </div>
  </Panel>
  <Panel
    position="top-left"
    class="graph-controls-panel"
    :class="{ 'graph-controls-panel-with-search': !!graphSearchContext }"
  >
    <div
      class="graph-controls-shell bg-background-paper rounded-lg border border-border-default shadow-xl"
      :class="{ 'graph-controls-shell-with-search': !!graphSearchContext }"
    >
      <div class="section">
        <div class="section-header-static">
          <span class="section-label">Analysis</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Analysis options</legend>
            <div class="control-group">
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
        </div>
      </div>

      <div class="section section-divider">
        <div class="section-header-static">
          <span class="section-label">Relationship Types</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Relationship visibility filters</legend>
            <div class="control-group">
              <div v-for="type in relationshipTypes" :key="type" class="space-y-1">
                <label
                  class="control-row"
                  :class="isRelationshipDisabled(type) ? 'control-row-disabled' : 'control-row-interactive'"
                >
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

      <div class="section section-divider">
        <div class="section-header-static">
          <span class="section-label">Performance</span>
        </div>
        <div class="section-content">
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

      <div class="section section-divider">
        <div class="section-header-static">
          <span class="section-label">Debug</span>
        </div>
        <div class="section-content">
          <fieldset class="control-fieldset">
            <legend class="sr-only">Debug rendering options</legend>
            <div class="control-group">
              <label class="control-row control-row-interactive">
                <input
                  type="checkbox"
                  class="control-checkbox"
                  :checked="graphSettings.showDebugNodeIds"
                  @change="(e) => graphSettings.setShowDebugNodeIds((e.target as HTMLInputElement).checked)"
                />
                <span class="control-label">Show node IDs</span>
              </label>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.graph-search-shell {
  width: min(24rem, calc(100vw - 1.5rem));
  padding: 0.42rem 0.5rem;
}

.graph-controls-panel-with-search {
  margin-top: 3.85rem;
}

.graph-controls-shell {
  width: min(24rem, calc(100vw - 1.5rem));
  max-height: calc(100vh - 1.5rem);
  padding: 0.68rem 0.68rem 0.92rem;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
}

.graph-controls-shell-with-search {
  max-height: calc(100vh - 5.35rem);
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

.section {
  margin: 0;
}

.section-divider {
  margin-top: 0.62rem;
  padding-top: 0.62rem;
  border-top: 1px solid rgba(var(--border-default-rgb, 64, 64, 64), 0.7);
}

.section-header-static {
  display: flex;
  align-items: center;
  min-height: 1.8rem;
  padding: 0.28rem 0.34rem;
}

.section-label {
  font-size: 0.84rem;
  font-weight: 650;
  color: var(--color-text-primary, currentColor);
  letter-spacing: 0.01em;
}

.section-content {
  padding: 0.3rem 0.34rem 0.14rem;
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
  gap: 0.34rem;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.5rem;
  font-size: 0.75rem;
  line-height: 1.25;
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
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
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
