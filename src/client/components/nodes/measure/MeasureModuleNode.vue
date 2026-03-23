<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import MeasureBaseNode from './MeasureBaseNode.vue';
import CollapsibleSection from '../CollapsibleSection.vue';
import EntityListSection from '../EntityListSection.vue';
import SymbolCardSection from '../SymbolCardSection.vue';
import {
  sortEmbeddedSymbols,
  sortExternalDependencies,
  sortModuleEntities,
  sortNodeProperties,
  sortSectionsByTitle,
} from '../moduleNodeSorting';
import { ENTITY_TYPE_CONFIGS, formatMethod, formatProperty, resolveSubnodesCount } from '../utils';

import type { DependencyData } from '../../../../shared/types/graph/DependencyData';
import type { EmbeddedModuleEntity } from '../../../../shared/types/graph/EmbeddedModuleEntity';
import type { EmbeddedSymbol } from '../../../../shared/types/graph/EmbeddedSymbol';
import type { ExternalDependencyRef } from '../../../../shared/types/graph/ExternalDependencyRef';
import type { DependencyNode } from '../../../types/DependencyNode';

interface MeasureModuleNodeProps {
  node: DependencyNode;
}

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

const props = defineProps<MeasureModuleNodeProps>();

const nodeData = computed<Partial<DependencyData> & { label: string }>(() => ({
  label: props.node.id,
  ...(props.node.data ?? {}),
}));
const surfaceStyle = computed(() =>
  props.node.style && typeof props.node.style === 'object' && !Array.isArray(props.node.style)
    ? (props.node.style as Record<string, string | number>)
    : undefined
);
const metadataItems = computed(() => sortNodeProperties(nodeData.value.properties ?? []));
const externalDependencies = computed<ExternalDependencyRef[]>(() => {
  const metadata = nodeData.value.externalDependencies;
  return Array.isArray(metadata) ? sortExternalDependencies(metadata) : [];
});
const embeddedSymbols = computed<EmbeddedSymbol[]>(() => {
  const symbols = nodeData.value.symbols;
  return Array.isArray(symbols) ? sortEmbeddedSymbols(symbols) : [];
});
const expandedSymbols = shallowRef<Set<string>>(new Set());

const formattedSymbolsByType = computed(() => {
  const classes: ReturnType<typeof formatSymbol>[] = [];
  const interfaces: ReturnType<typeof formatSymbol>[] = [];

  for (const symbol of embeddedSymbols.value) {
    const formatted = formatSymbol(symbol);
    if (symbol.type === 'class') {
      classes.push(formatted);
    } else {
      interfaces.push(formatted);
    }
  }

  return { classes, interfaces };
});

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

  const rawEntities = Array.isArray(nodeData.value.moduleEntities) ? nodeData.value.moduleEntities : [];
  const sortedEntities = sortModuleEntities(rawEntities);
  const entitiesByType = new Map<EmbeddedModuleEntity['type'], EmbeddedModuleEntity[]>();
  for (const entity of sortedEntities) {
    const group = entitiesByType.get(entity.type) ?? [];
    group.push(entity);
    entitiesByType.set(entity.type, group);
  }

  const entitySections: EntityContentSection[] = ENTITY_TYPE_CONFIGS.filter(
    (config) => (entitiesByType.get(config.type)?.length ?? 0) > 0
  ).map((config) => ({
    kind: 'entity',
    key: config.type,
    title: config.title,
    badgeText: config.badgeText,
    badgeClass: config.badgeClass,
    entities: entitiesByType.get(config.type) ?? [],
  }));

  return sortSectionsByTitle([...symbolSections, ...entitySections]);
});

const hasContentSections = computed(() => contentSections.value.length > 0);
const subnodeMeta = computed(
  () =>
    nodeData.value.subnodes as
      | {
          count?: number;
          totalCount?: number;
          hiddenCount?: number;
          byTypeTotal?: Partial<Record<'class' | 'interface', number>>;
          byTypeVisible?: Partial<Record<'class' | 'interface', number>>;
        }
      | undefined
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

function formatSymbol(symbol: EmbeddedSymbol) {
  return {
    ...symbol,
    formattedProperties: symbol.properties.map(formatProperty),
    formattedMethods: symbol.methods.map(formatMethod),
  };
}
</script>

<template>
  <MeasureBaseNode
    :label="nodeData.label"
    badge-text="MODULE"
    badge-class="type-module"
    :surface-style="surfaceStyle"
    :is-container="true"
    :show-subnodes="hasVueFlowChildren || subnodesResolved.hiddenCount > 0"
    :subnodes-count="subnodesResolved.totalCount"
    min-width="180px"
  >
    <template #body>
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

      <CollapsibleSection
        v-if="externalDependencies.length > 0"
        title="External Dependencies"
        :count="externalDependencies.length"
        :default-open="true"
      >
        <div v-for="dependency in externalDependencies" :key="dependency.packageName" class="external-dependency">
          <div class="external-dependency-name">{{ dependency.packageName }}</div>
          <ul class="external-dependency-symbols" :aria-label="`Imported symbols from ${dependency.packageName}`">
            <li v-for="(sym, symIdx) in dependency.symbols" :key="`${dependency.packageName}-${symIdx}-${sym}`">
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
            @toggle-symbol="() => undefined"
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
        v-if="metadataItems.length === 0 && externalDependencies.length === 0 && !hasContentSections"
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
  </MeasureBaseNode>
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
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.6rem;
  padding: 0.35rem 0.45rem;
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.03);
}

.external-dependency-name {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  font-weight: 700;
  font-size: 0.72rem;
}

.external-dependency-symbols {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.12rem;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  text-align: right;
}

.external-dependency-symbols > li {
  width: 100%;
  text-align: right;
}

.external-dependency-symbol {
  display: inline-block;
  max-width: 100%;
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
</style>
