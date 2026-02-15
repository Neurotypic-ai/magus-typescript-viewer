<script setup lang="ts">
import { computed, ref, shallowRef, toRef } from 'vue';

import { useGraphSettings } from '../../stores/graphSettings';
import BaseNode from './BaseNode.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import EntityListSection from './EntityListSection.vue';
import SymbolCardSection from './SymbolCardSection.vue';
import { useIsolateExpandState } from './useIsolateExpandState';
import { ENTITY_TYPE_CONFIGS, buildBaseNodeProps, formatMethod, formatProperty, resolveSubnodesCount } from './utils';

import type { DependencyProps, EmbeddedModuleEntity, EmbeddedSymbol, ExternalDependencyRef } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = toRef(props, 'data');

const metadataItems = computed(() => nodeData.value.properties ?? []);
const externalDependencies = computed<ExternalDependencyRef[]>(() => {
  const metadata = nodeData.value.externalDependencies;
  return Array.isArray(metadata) ? metadata : [];
});

const embeddedSymbols = computed<EmbeddedSymbol[]>(() => {
  const symbols = nodeData.value.symbols;
  return Array.isArray(symbols) ? symbols : [];
});

const graphSettings = useGraphSettings();

const moduleEntities = computed<EmbeddedModuleEntity[]>(() => {
  const entities = nodeData.value.moduleEntities;
  return Array.isArray(entities) ? entities : [];
});

const entitySections = computed(() => {
  const enabledTypes = new Set(graphSettings.enabledModuleMemberTypes);
  return ENTITY_TYPE_CONFIGS.filter((config) => enabledTypes.has(config.type))
    .map((config) => ({
      ...config,
      entities: moduleEntities.value.filter((e) => e.type === config.type),
    }))
    .filter((section) => section.entities.length > 0);
});

const hasModuleEntities = computed(() => entitySections.value.length > 0);

// Symbol expand/collapse
const expandedSymbols = shallowRef<Set<string>>(new Set());
const toggleSymbol = (id: string) => {
  const next = new Set(expandedSymbols.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedSymbols.value = next;
};

// Formatted symbols split by type
const formattedSymbolsByType = computed(() => {
  const classes: ReturnType<typeof formatSymbol>[] = [];
  const interfaces: ReturnType<typeof formatSymbol>[] = [];
  for (const symbol of embeddedSymbols.value) {
    const formatted = formatSymbol(symbol);
    if (symbol.type === 'class') classes.push(formatted);
    else interfaces.push(formatted);
  }
  return { classes, interfaces };
});

function formatSymbol(symbol: EmbeddedSymbol) {
  return {
    ...symbol,
    formattedProperties: symbol.properties.map(formatProperty),
    formattedMethods: symbol.methods.map(formatMethod),
  };
}

// Diagnostics
const diagnostics = computed(
  () =>
    nodeData.value.diagnostics as
      | {
          externalDependencyLevel?: 'normal' | 'high' | 'critical';
        }
      | undefined,
);

// Subnodes
const subnodeMeta = computed(
  () =>
    nodeData.value.subnodes as
      | {
          count?: number;
          totalCount?: number;
          visibleCount?: number;
          hiddenCount?: number;
          byTypeTotal?: Partial<Record<'class' | 'interface', number>>;
          byTypeVisible?: Partial<Record<'class' | 'interface', number>>;
        }
      | undefined,
);

const subnodesResolved = computed(() => resolveSubnodesCount(subnodeMeta.value));

const hiddenSubnodeSummary = computed(() => {
  if (subnodesResolved.value.hiddenCount === 0) {
    return '';
  }

  const byTypeTotal = subnodeMeta.value?.byTypeTotal ?? {};
  const byTypeVisible = subnodeMeta.value?.byTypeVisible ?? {};
  const hiddenClassCount = Math.max(0, (byTypeTotal.class ?? 0) - (byTypeVisible.class ?? 0));
  const hiddenInterfaceCount = Math.max(0, (byTypeTotal.interface ?? 0) - (byTypeVisible.interface ?? 0));
  const segments: string[] = [];

  if (hiddenClassCount > 0) {
    segments.push(`${hiddenClassCount} class${hiddenClassCount === 1 ? '' : 'es'}`);
  }
  if (hiddenInterfaceCount > 0) {
    segments.push(`${hiddenInterfaceCount} interface${hiddenInterfaceCount === 1 ? '' : 's'}`);
  }

  if (segments.length === 0) {
    return `${subnodesResolved.value.hiddenCount} hidden`;
  }

  return `Hidden: ${segments.join(', ')}`;
});

const hasVueFlowChildren = computed(() => nodeData.value.isContainer === true && subnodesResolved.value.count > 0);

const baseNodeProps = computed(() =>
  buildBaseNodeProps(props, {
    isContainer: hasVueFlowChildren.value,
    showSubnodes: hasVueFlowChildren.value || subnodesResolved.value.hiddenCount > 0,
    subnodesCount: subnodesResolved.value.count,
  }),
);

// External deps show-more
const showAllExternalDeps = ref(false);
const visibleExternalDependencies = computed(() =>
  showAllExternalDeps.value ? externalDependencies.value : externalDependencies.value.slice(0, 8),
);
const hiddenExternalDependencyCount = computed(() => Math.max(0, externalDependencies.value.length - 8));

// Pre-isolate state (CollapsibleSection handles its own open/close state)
useIsolateExpandState(
  () => ({
    showAllExternalDeps: showAllExternalDeps.value,
    expandedSymbols: new Set(expandedSymbols.value),
  }),
  (saved) => {
    showAllExternalDeps.value = saved.showAllExternalDeps;
    expandedSymbols.value = new Set(saved.expandedSymbols);
  },
  () => {
    showAllExternalDeps.value = true;
    expandedSymbols.value = new Set(embeddedSymbols.value.map((s) => s.id));
  },
);
</script>

<template>
  <BaseNode
    v-bind="baseNodeProps"
    badge-text="MODULE"
    badge-class="type-module"
    :class="[
      diagnostics?.externalDependencyLevel === 'high' && 'module-node--high-deps',
      diagnostics?.externalDependencyLevel === 'critical' && 'module-node--critical-deps',
    ]"
  >
    <template #body>
      <!-- Metadata -->
      <CollapsibleSection
        v-if="metadataItems.length > 0"
        title="Metadata"
        :count="metadataItems.length"
        :default-open="true"
      >
        <div
          v-for="(prop, index) in metadataItems"
          :key="`metadata-${prop.name}-${prop.type}-${index}`"
          class="metadata-item"
        >
          <span class="metadata-key">{{ prop.name }}:</span>
          <span class="metadata-value" :title="prop.type">{{ prop.type }}</span>
        </div>
      </CollapsibleSection>

      <!-- External Dependencies -->
      <CollapsibleSection
        v-if="externalDependencies.length > 0"
        title="External Dependencies"
        :count="externalDependencies.length"
        :default-open="true"
      >
        <div
          v-for="dependency in visibleExternalDependencies"
          :key="dependency.packageName"
          class="external-dependency"
        >
          <div class="external-dependency-name">{{ dependency.packageName }}</div>
          <div class="external-dependency-symbols">
            {{ dependency.symbols.slice(0, 6).join(', ') }}
            <span v-if="dependency.symbols.length > 6"> (+{{ dependency.symbols.length - 6 }} more)</span>
          </div>
        </div>
        <button
          v-if="hiddenExternalDependencyCount > 0 && !showAllExternalDeps"
          type="button"
          class="dependency-more-button nodrag"
          @click="showAllExternalDeps = true"
        >
          +{{ hiddenExternalDependencyCount }} more packages
        </button>
      </CollapsibleSection>

      <!-- Embedded Symbols -->
      <div v-if="embeddedSymbols.length > 0" class="module-symbols">
        <SymbolCardSection
          v-if="formattedSymbolsByType.classes.length > 0"
          title="Classes"
          :symbols="formattedSymbolsByType.classes"
          badge-text="CLASS"
          badge-class="type-class"
          :expanded-symbols="expandedSymbols"
          @toggle-symbol="toggleSymbol"
        />
        <SymbolCardSection
          v-if="formattedSymbolsByType.interfaces.length > 0"
          title="Interfaces"
          :symbols="formattedSymbolsByType.interfaces"
          badge-text="INTERFACE"
          badge-class="type-interface"
          :expanded-symbols="expandedSymbols"
          @toggle-symbol="toggleSymbol"
        />
      </div>

      <!-- Module-level entities -->
      <div v-if="hasModuleEntities" class="module-entities">
        <EntityListSection
          v-for="section in entitySections"
          :key="section.type"
          :title="section.title"
          :entities="section.entities"
          :badge-text="section.badgeText"
          :badge-class="section.badgeClass"
        />
      </div>

      <div
        v-if="
          metadataItems.length === 0 &&
          externalDependencies.length === 0 &&
          embeddedSymbols.length === 0 &&
          !hasModuleEntities
        "
        class="module-empty-state"
      >
        No module metadata
      </div>
    </template>

    <template #subnodes>
      <div v-if="subnodesResolved.count > 0" class="subnode-hint">
        Child class/interface nodes are laid out in this module container.
      </div>
      <div v-if="hiddenSubnodeSummary" class="subnode-hint">{{ hiddenSubnodeSummary }}</div>
    </template>
  </BaseNode>
</template>

<style scoped>
.metadata-item {
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
  font-size: 0.72rem;
}

.metadata-key {
  color: var(--text-secondary);
  font-weight: 600;
  min-width: 58px;
}

.metadata-value {
  color: var(--text-primary);
  white-space: nowrap;
}

.external-dependency {
  padding: 0.35rem 0.45rem;
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.03);
}

.external-dependency-name {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 0.72rem;
}

.external-dependency-symbols {
  color: var(--text-secondary);
  font-size: 0.68rem;
  line-height: 1.1;
  margin-top: 0.15rem;
  white-space: nowrap;
}

.module-empty-state,
.subnode-hint {
  color: var(--text-secondary);
  font-size: 0.7rem;
  opacity: 0.8;
}

.dependency-more-button {
  border: 1px solid rgba(var(--border-default-rgb), 0.5);
  border-radius: 0.3rem;
  padding: 0.25rem 0.4rem;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  font-size: 0.66rem;
  cursor: pointer;
}

.dependency-more-button:hover {
  background: rgba(255, 255, 255, 0.08);
}

.module-symbols {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.module-entities {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.module-node--high-deps :deep(.base-node-container) {
  outline: 1px solid rgba(245, 158, 11, 0.55);
  outline-offset: 0;
  box-shadow: 0 1px 4px rgba(245, 158, 11, 0.2);
}

.module-node--critical-deps :deep(.base-node-container) {
  outline: 1px solid rgba(239, 68, 68, 0.62);
  outline-offset: 0;
  box-shadow: 0 1px 4px rgba(239, 68, 68, 0.24);
}
</style>
