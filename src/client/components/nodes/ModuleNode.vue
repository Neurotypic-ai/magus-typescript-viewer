<script setup lang="ts">
import { computed, shallowRef, toRef } from 'vue';

import BaseNode from './BaseNode.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import EntityListSection from './EntityListSection.vue';
import SymbolCardSection from './SymbolCardSection.vue';
import {
  sortEmbeddedSymbols,
  sortExternalDependencies,
  sortModuleEntities,
  sortNodeProperties,
  sortSectionsByTitle,
} from './moduleNodeSorting';
import { useExpandCollapseState } from '../../composables/useExpandCollapseState';
import { ENTITY_TYPE_CONFIGS, buildBaseNodeProps, formatMethod, formatProperty, resolveSubnodesCount } from './utils';

import type { DependencyProps } from '../../types/DependencyProps';
import type { EmbeddedModuleEntity } from '../../types/EmbeddedModuleEntity';
import type { EmbeddedSymbol } from '../../types/EmbeddedSymbol';
import type { ExternalDependencyRef } from '../../types/ExternalDependencyRef';

const props = defineProps<DependencyProps>();

const nodeData = toRef(props, 'data');

const metadataItems = computed(() => sortNodeProperties(nodeData.value.properties ?? []));
const externalDependencies = computed<ExternalDependencyRef[]>(() => {
  const metadata = nodeData.value.externalDependencies;
  return Array.isArray(metadata) ? sortExternalDependencies(metadata) : [];
});

const embeddedSymbols = computed<EmbeddedSymbol[]>(() => {
  const symbols = nodeData.value.symbols;
  return Array.isArray(symbols) ? sortEmbeddedSymbols(symbols) : [];
});

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

interface SymbolContentSection {
  kind: 'symbol';
  key: string;
  title: string;
  badgeText: string;
  badgeClass: string;
  symbols: ReturnType<typeof formatSymbol>[];
}

interface EntityContentSection {
  kind: 'entity';
  key: string;
  title: string;
  badgeText: string;
  badgeClass: string;
  entities: EmbeddedModuleEntity[];
}

type ModuleContentSection = SymbolContentSection | EntityContentSection;

const contentSections = computed<ModuleContentSection[]>(() => {
  const symbolSections: SymbolContentSection[] = [];
  if (formattedSymbolsByType.value.classes.length > 0) {
    symbolSections.push({
      kind: 'symbol',
      key: 'symbol-classes',
      title: 'Classes',
      badgeText: 'CLASS',
      badgeClass: 'type-class',
      symbols: formattedSymbolsByType.value.classes,
    });
  }
  if (formattedSymbolsByType.value.interfaces.length > 0) {
    symbolSections.push({
      kind: 'symbol',
      key: 'symbol-interfaces',
      title: 'Interfaces',
      badgeText: 'INTERFACE',
      badgeClass: 'type-interface',
      symbols: formattedSymbolsByType.value.interfaces,
    });
  }

  const rawEntities = Array.isArray(nodeData.value.moduleEntities)
    ? nodeData.value.moduleEntities
    : [];
  const sortedEntities = sortModuleEntities(rawEntities);

  const entitiesByType = new Map<EmbeddedModuleEntity['type'], EmbeddedModuleEntity[]>();
  for (const entity of sortedEntities) {
    const group = entitiesByType.get(entity.type) ?? [];
    group.push(entity);
    entitiesByType.set(entity.type, group);
  }

  const entityContentSections: EntityContentSection[] = ENTITY_TYPE_CONFIGS
    .filter((config) => (entitiesByType.get(config.type)?.length ?? 0) > 0)
    .map((config) => ({
      kind: 'entity',
      key: config.type,
      title: config.title,
      badgeText: config.badgeText,
      badgeClass: config.badgeClass,
      entities: entitiesByType.get(config.type) ?? [],
    }));

  const sections: ModuleContentSection[] = [
    ...symbolSections,
    ...entityContentSections,
  ];

  return sortSectionsByTitle(sections);
});

const hasContentSections = computed(() => contentSections.value.length > 0);

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
    segments.push(`${String(hiddenClassCount)} class${hiddenClassCount === 1 ? '' : 'es'}`);
  }
  if (hiddenInterfaceCount > 0) {
    segments.push(`${String(hiddenInterfaceCount)} interface${hiddenInterfaceCount === 1 ? '' : 's'}`);
  }

  if (segments.length === 0) {
    return `${String(subnodesResolved.value.hiddenCount)} hidden`;
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

// Pre-isolate state (CollapsibleSection handles its own open/close state)
useExpandCollapseState(
  () => ({
    expandedSymbols: new Set(expandedSymbols.value),
  }),
  (saved) => {
    expandedSymbols.value = new Set(saved.expandedSymbols);
  },
  () => {
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
          v-for="dependency in externalDependencies"
          :key="dependency.packageName"
          class="external-dependency"
        >
          <div class="external-dependency-name">{{ dependency.packageName }}</div>
          <ul class="external-dependency-symbols" role="list">
            <li v-for="(sym, symIdx) in dependency.symbols" :key="`${dependency.packageName}-${symIdx}-${sym}`" role="listitem">
              <code class="external-dependency-symbol">{{ sym }}</code>
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      <div v-if="hasContentSections" class="module-sections">
        <template v-for="section in contentSections" :key="section.key">
          <SymbolCardSection
            v-if="section.kind === 'symbol'"
            :title="section.title"
            :symbols="section.symbols"
            :badge-text="section.badgeText"
            :badge-class="section.badgeClass"
            :expanded-symbols="expandedSymbols"
            @toggle-symbol="toggleSymbol"
          />
          <EntityListSection
            v-else
            :title="section.title"
            :entities="section.entities"
            :badge-text="section.badgeText"
            :badge-class="section.badgeClass"
          />
        </template>
      </div>

      <div
        v-if="
          metadataItems.length === 0 &&
          externalDependencies.length === 0 &&
          !hasContentSections
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
  list-style: none;
  margin: 0.15rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.external-dependency-symbol {
  display: block;
  color: var(--text-secondary);
  font-size: 0.68rem;
  line-height: 1.25;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.module-empty-state,
.subnode-hint {
  color: var(--text-secondary);
  font-size: 0.7rem;
  opacity: 0.8;
}

.module-sections {
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
