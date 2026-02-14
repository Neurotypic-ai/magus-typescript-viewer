<script setup lang="ts">
import { computed, inject, ref, shallowRef, toRef, watch } from 'vue';

import BaseNode from './BaseNode.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { buildBaseNodeProps, ISOLATE_EXPAND_ALL_KEY } from './utils';

import { useGraphSettings } from '../../../stores/graphSettings';

import type { DependencyProps, EmbeddedModuleEntity, EmbeddedSymbol, ExternalDependencyRef, NodeMethod, NodeProperty } from '../types';

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

const embeddedClasses = computed(() => embeddedSymbols.value.filter(s => s.type === 'class'));
const embeddedInterfaces = computed(() => embeddedSymbols.value.filter(s => s.type === 'interface'));

const graphSettings = useGraphSettings();

const moduleEntities = computed<EmbeddedModuleEntity[]>(() => {
  const entities = nodeData.value.moduleEntities;
  return Array.isArray(entities) ? entities : [];
});

const embeddedFunctions = computed(() =>
  graphSettings.enabledModuleMemberTypes.includes('function')
    ? moduleEntities.value.filter(e => e.type === 'function')
    : []
);
const embeddedTypes = computed(() =>
  graphSettings.enabledModuleMemberTypes.includes('type')
    ? moduleEntities.value.filter(e => e.type === 'type')
    : []
);
const embeddedEnums = computed(() =>
  graphSettings.enabledModuleMemberTypes.includes('enum')
    ? moduleEntities.value.filter(e => e.type === 'enum')
    : []
);
const embeddedConsts = computed(() =>
  graphSettings.enabledModuleMemberTypes.includes('const')
    ? moduleEntities.value.filter(e => e.type === 'const')
    : []
);
const embeddedVars = computed(() =>
  graphSettings.enabledModuleMemberTypes.includes('var')
    ? moduleEntities.value.filter(e => e.type === 'var')
    : []
);

const hasModuleEntities = computed(() =>
  embeddedFunctions.value.length > 0 ||
  embeddedTypes.value.length > 0 ||
  embeddedEnums.value.length > 0 ||
  embeddedConsts.value.length > 0 ||
  embeddedVars.value.length > 0
);

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
const isSymbolExpanded = (id: string) => expandedSymbols.value.has(id);

const diagnostics = computed(() => nodeData.value.diagnostics as {
  externalDependencyLevel?: 'normal' | 'high' | 'critical';
} | undefined);

const subnodeCount = computed(() => {
  const count = (nodeData.value.subnodes as { count?: number } | undefined)?.count;
  return typeof count === 'number' ? count : 0;
});

const subnodeMeta = computed(() => (nodeData.value.subnodes as {
  totalCount?: number;
  visibleCount?: number;
  hiddenCount?: number;
  byTypeTotal?: Partial<Record<'class' | 'interface', number>>;
  byTypeVisible?: Partial<Record<'class' | 'interface', number>>;
} | undefined));

const totalSubnodeCount = computed(() => {
  const total = subnodeMeta.value?.totalCount;
  if (typeof total === 'number') {
    return total;
  }
  return subnodeCount.value;
});

const hiddenSubnodeCount = computed(() => {
  const hidden = subnodeMeta.value?.hiddenCount;
  if (typeof hidden === 'number') {
    return Math.max(0, hidden);
  }
  return Math.max(0, totalSubnodeCount.value - subnodeCount.value);
});

const hiddenSubnodeSummary = computed(() => {
  if (hiddenSubnodeCount.value === 0) {
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
    return `${hiddenSubnodeCount.value} hidden`;
  }

  return `Hidden: ${segments.join(', ')}`;
});

const hasVueFlowChildren = computed(() => nodeData.value.isContainer === true && subnodeCount.value > 0);

const baseNodeProps = computed(() => buildBaseNodeProps(props, {
  isContainer: hasVueFlowChildren.value,
  showSubnodes: hasVueFlowChildren.value || hiddenSubnodeCount.value > 0,
  subnodesCount: subnodeCount.value,
}));

const showMetadata = ref(true);
const showExternalDeps = ref(true);
const showAllExternalDeps = ref(false);
const preIsolateExpandState = shallowRef<{
  showMetadata: boolean;
  showExternalDeps: boolean;
  showAllExternalDeps: boolean;
  expandedSymbols: Set<string>;
} | null>(null);

const isolateExpandAll = inject(ISOLATE_EXPAND_ALL_KEY, ref(false));
watch(isolateExpandAll, (expand) => {
  if (expand) {
    if (!preIsolateExpandState.value) {
      preIsolateExpandState.value = {
        showMetadata: showMetadata.value,
        showExternalDeps: showExternalDeps.value,
        showAllExternalDeps: showAllExternalDeps.value,
        expandedSymbols: new Set(expandedSymbols.value),
      };
    }
    showMetadata.value = true;
    showExternalDeps.value = true;
    showAllExternalDeps.value = true;
    expandedSymbols.value = new Set(embeddedSymbols.value.map((s) => s.id));
    return;
  }

  if (preIsolateExpandState.value) {
    showMetadata.value = preIsolateExpandState.value.showMetadata;
    showExternalDeps.value = preIsolateExpandState.value.showExternalDeps;
    showAllExternalDeps.value = preIsolateExpandState.value.showAllExternalDeps;
    expandedSymbols.value = new Set(preIsolateExpandState.value.expandedSymbols);
    preIsolateExpandState.value = null;
  }
});

const visibleExternalDependencies = computed(() => {
  return showAllExternalDeps.value ? externalDependencies.value : externalDependencies.value.slice(0, 8);
});

const hiddenExternalDependencyCount = computed(() => Math.max(0, externalDependencies.value.length - 8));

const visibilityIndicator = (visibility: string): string => {
  switch (visibility) {
    case 'public':
      return 'p';
    case 'protected':
      return '#';
    case 'private':
      return '-';
    default:
      return 'p';
  }
};

const formatProperty = (prop: NodeProperty): { key: string; indicator: string; name: string; type: string } => ({
  key: `${prop.name}:${prop.type ?? 'unknown'}:${prop.visibility ?? 'default'}`,
  indicator: visibilityIndicator(prop.visibility),
  name: prop.name,
  type: prop.type || 'unknown',
});

const formatMethod = (method: NodeMethod): { key: string; indicator: string; name: string; returnType: string } => ({
  key: `${method.name}:${method.returnType ?? 'void'}:${method.visibility ?? 'default'}`,
  indicator: visibilityIndicator(method.visibility),
  name: method.name,
  returnType: method.returnType || 'void',
});

const formattedEmbeddedClasses = computed(() =>
  embeddedClasses.value.map(symbol => ({
    ...symbol,
    formattedProperties: symbol.properties.map(formatProperty),
    formattedMethods: symbol.methods.map(formatMethod),
  }))
);

const formattedEmbeddedInterfaces = computed(() =>
  embeddedInterfaces.value.map(symbol => ({
    ...symbol,
    formattedProperties: symbol.properties.map(formatProperty),
    formattedMethods: symbol.methods.map(formatMethod),
  }))
);
</script>

<template>
  <BaseNode
    v-bind="baseNodeProps"
    badge-text="MODULE"
    :class="[
      diagnostics?.externalDependencyLevel === 'high' && 'module-node--high-deps',
      diagnostics?.externalDependencyLevel === 'critical' && 'module-node--critical-deps',
    ]"
  >
    <template #body>
      <div v-if="metadataItems.length > 0" class="module-section">
        <button class="module-section-toggle nodrag" type="button" @click="showMetadata = !showMetadata">
          <span>Metadata</span>
          <span>{{ showMetadata ? '−' : '+' }}</span>
        </button>
        <div v-if="showMetadata" class="module-section-content nowheel">
          <div v-for="(prop, index) in metadataItems" :key="`metadata-${prop.name}-${prop.type}-${index}`" class="metadata-item">
            <span class="metadata-key">{{ prop.name }}:</span>
            <span class="metadata-value" :title="prop.type">{{ prop.type }}</span>
          </div>
        </div>
      </div>

      <div v-if="externalDependencies.length > 0" class="module-section">
        <button class="module-section-toggle nodrag" type="button" @click="showExternalDeps = !showExternalDeps">
          <span>External Dependencies</span>
          <span>{{ showExternalDeps ? '−' : '+' }}</span>
        </button>
        <div v-if="showExternalDeps" class="module-section-content nowheel">
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
          </div>
      </div>

      <!-- Embedded symbols in compact mode — type-grouped hierarchy -->
      <div v-if="embeddedSymbols.length > 0" class="module-symbols">
        <!-- Classes category -->
        <CollapsibleSection
          v-if="formattedEmbeddedClasses.length > 0"
          :title="`Classes`"
          :count="formattedEmbeddedClasses.length"
          :default-open="true"
        >
          <div
            v-for="symbol in formattedEmbeddedClasses"
            :key="symbol.id"
            class="symbol-card"
          >
            <button class="symbol-card-header nodrag" type="button" @click.stop="toggleSymbol(symbol.id)">
              <span class="symbol-card-badge type-class">CLASS</span>
              <span class="symbol-card-name">{{ symbol.name }}</span>
              <span class="symbol-card-count">{{ symbol.formattedProperties.length + symbol.formattedMethods.length }}</span>
              <span class="symbol-card-toggle">{{ isSymbolExpanded(symbol.id) ? '\u2212' : '+' }}</span>
            </button>
            <div v-if="isSymbolExpanded(symbol.id)" class="symbol-card-body">
              <CollapsibleSection
                v-if="symbol.formattedProperties.length > 0"
                title="Properties"
                :count="symbol.formattedProperties.length"
                :default-open="true"
              >
                <div
                  v-for="prop in symbol.formattedProperties.slice(0, 8)"
                  :key="`prop-${symbol.id}-${prop.key}`"
                  class="member-item"
                >
                  <span class="member-visibility">{{ prop.indicator }}</span>
                  <span class="member-name">{{ prop.name }}</span>
                  <span class="member-type-annotation">: {{ prop.type }}</span>
                </div>
                <div v-if="symbol.formattedProperties.length > 8" class="member-overflow">
                  +{{ symbol.formattedProperties.length - 8 }} more
                </div>
              </CollapsibleSection>
              <CollapsibleSection
                v-if="symbol.formattedMethods.length > 0"
                title="Methods"
                :count="symbol.formattedMethods.length"
                :default-open="true"
              >
                <div
                  v-for="method in symbol.formattedMethods.slice(0, 8)"
                  :key="`method-${symbol.id}-${method.key}`"
                  class="member-item"
                >
                  <span class="member-visibility">{{ method.indicator }}</span>
                  <span class="member-name">{{ method.name }}()</span>
                  <span class="member-type-annotation">: {{ method.returnType }}</span>
                </div>
                <div v-if="symbol.formattedMethods.length > 8" class="member-overflow">
                  +{{ symbol.formattedMethods.length - 8 }} more
                </div>
              </CollapsibleSection>
            </div>
          </div>
        </CollapsibleSection>

        <!-- Interfaces category -->
        <CollapsibleSection
          v-if="formattedEmbeddedInterfaces.length > 0"
          :title="`Interfaces`"
          :count="formattedEmbeddedInterfaces.length"
          :default-open="true"
        >
          <div
            v-for="symbol in formattedEmbeddedInterfaces"
            :key="symbol.id"
            class="symbol-card"
          >
            <button class="symbol-card-header nodrag" type="button" @click.stop="toggleSymbol(symbol.id)">
              <span class="symbol-card-badge type-interface">INTERFACE</span>
              <span class="symbol-card-name">{{ symbol.name }}</span>
              <span class="symbol-card-count">{{ symbol.formattedProperties.length + symbol.formattedMethods.length }}</span>
              <span class="symbol-card-toggle">{{ isSymbolExpanded(symbol.id) ? '\u2212' : '+' }}</span>
            </button>
            <div v-if="isSymbolExpanded(symbol.id)" class="symbol-card-body">
              <CollapsibleSection
                v-if="symbol.formattedProperties.length > 0"
                title="Properties"
                :count="symbol.formattedProperties.length"
                :default-open="true"
              >
                <div
                  v-for="prop in symbol.formattedProperties.slice(0, 8)"
                  :key="`prop-${symbol.id}-${prop.key}`"
                  class="member-item"
                >
                  <span class="member-visibility">{{ prop.indicator }}</span>
                  <span class="member-name">{{ prop.name }}</span>
                  <span class="member-type-annotation">: {{ prop.type }}</span>
                </div>
                <div v-if="symbol.formattedProperties.length > 8" class="member-overflow">
                  +{{ symbol.formattedProperties.length - 8 }} more
                </div>
              </CollapsibleSection>
              <CollapsibleSection
                v-if="symbol.formattedMethods.length > 0"
                title="Methods"
                :count="symbol.formattedMethods.length"
                :default-open="true"
              >
                <div
                  v-for="method in symbol.formattedMethods.slice(0, 8)"
                  :key="`method-${symbol.id}-${method.key}`"
                  class="member-item"
                >
                  <span class="member-visibility">{{ method.indicator }}</span>
                  <span class="member-name">{{ method.name }}()</span>
                  <span class="member-type-annotation">: {{ method.returnType }}</span>
                </div>
                <div v-if="symbol.formattedMethods.length > 8" class="member-overflow">
                  +{{ symbol.formattedMethods.length - 8 }} more
                </div>
              </CollapsibleSection>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      <!-- Module-level entities: functions, types, enums, consts, vars -->
      <div v-if="hasModuleEntities" class="module-entities">
        <!-- Functions -->
        <CollapsibleSection
          v-if="embeddedFunctions.length > 0"
          title="Functions"
          :count="embeddedFunctions.length"
          :default-open="false"
        >
          <div
            v-for="entity in (isolateExpandAll ? embeddedFunctions : embeddedFunctions.slice(0, 12))"
            :key="entity.id"
            class="entity-item"
          >
            <span class="entity-badge entity-function">FN</span>
            <span class="entity-name">{{ entity.name }}</span>
            <span class="entity-detail">{{ entity.detail }}</span>
            <span v-if="entity.tags?.includes('async')" class="entity-tag">async</span>
          </div>
          <div v-if="!isolateExpandAll && embeddedFunctions.length > 12" class="member-overflow">
            +{{ embeddedFunctions.length - 12 }} more
          </div>
        </CollapsibleSection>

        <!-- Type Aliases -->
        <CollapsibleSection
          v-if="embeddedTypes.length > 0"
          title="Types"
          :count="embeddedTypes.length"
          :default-open="false"
        >
          <div
            v-for="entity in (isolateExpandAll ? embeddedTypes : embeddedTypes.slice(0, 12))"
            :key="entity.id"
            class="entity-item"
          >
            <span class="entity-badge entity-type">TYPE</span>
            <span class="entity-name">{{ entity.name }}</span>
            <span class="entity-detail">{{ entity.detail }}</span>
          </div>
          <div v-if="!isolateExpandAll && embeddedTypes.length > 12" class="member-overflow">
            +{{ embeddedTypes.length - 12 }} more
          </div>
        </CollapsibleSection>

        <!-- Enums -->
        <CollapsibleSection
          v-if="embeddedEnums.length > 0"
          title="Enums"
          :count="embeddedEnums.length"
          :default-open="false"
        >
          <div
            v-for="entity in (isolateExpandAll ? embeddedEnums : embeddedEnums.slice(0, 12))"
            :key="entity.id"
            class="entity-item"
          >
            <span class="entity-badge entity-enum">ENUM</span>
            <span class="entity-name">{{ entity.name }}</span>
            <span class="entity-detail">{{ entity.detail }}</span>
          </div>
          <div v-if="!isolateExpandAll && embeddedEnums.length > 12" class="member-overflow">
            +{{ embeddedEnums.length - 12 }} more
          </div>
        </CollapsibleSection>

        <!-- Constants -->
        <CollapsibleSection
          v-if="embeddedConsts.length > 0"
          title="Constants"
          :count="embeddedConsts.length"
          :default-open="false"
        >
          <div
            v-for="entity in (isolateExpandAll ? embeddedConsts : embeddedConsts.slice(0, 12))"
            :key="entity.id"
            class="entity-item"
          >
            <span class="entity-badge entity-const">CONST</span>
            <span class="entity-name">{{ entity.name }}</span>
            <span class="entity-detail">{{ entity.detail }}</span>
          </div>
          <div v-if="!isolateExpandAll && embeddedConsts.length > 12" class="member-overflow">
            +{{ embeddedConsts.length - 12 }} more
          </div>
        </CollapsibleSection>

        <!-- Variables -->
        <CollapsibleSection
          v-if="embeddedVars.length > 0"
          title="Variables"
          :count="embeddedVars.length"
          :default-open="false"
        >
          <div
            v-for="entity in (isolateExpandAll ? embeddedVars : embeddedVars.slice(0, 12))"
            :key="entity.id"
            class="entity-item"
          >
            <span class="entity-badge entity-var">VAR</span>
            <span class="entity-name">{{ entity.name }}</span>
            <span class="entity-detail">{{ entity.detail }}</span>
          </div>
          <div v-if="!isolateExpandAll && embeddedVars.length > 12" class="member-overflow">
            +{{ embeddedVars.length - 12 }} more
          </div>
        </CollapsibleSection>
      </div>

      <div v-if="metadataItems.length === 0 && externalDependencies.length === 0 && embeddedSymbols.length === 0 && !hasModuleEntities" class="module-empty-state">
        No module metadata
      </div>
    </template>

    <template #subnodes>
      <div v-if="subnodeCount > 0" class="subnode-hint">
        Child class/interface nodes are laid out in this module container.
      </div>
      <div v-if="hiddenSubnodeSummary" class="subnode-hint">{{ hiddenSubnodeSummary }}</div>
    </template>
  </BaseNode>
</template>

<style scoped>
.module-section + .module-section {
  margin-top: 0.5rem;
}

.module-section-toggle {
  width: 100%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.55rem;
  cursor: pointer;
}

.module-section-content {
  margin-top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.metadata-item {
  display: flex;
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

.symbol-card {
  border: 1px solid rgba(var(--border-default-rgb), 0.4);
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.02);
}

.symbol-card-header {
  width: 100%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  font-size: 0.72rem;
}

.symbol-card-header:hover {
  background: rgba(255, 255, 255, 0.08);
}

.symbol-card-badge {
  padding: 0.1rem 0.25rem;
  border-radius: 0.2rem;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.symbol-card-name {
  color: var(--text-primary);
  font-weight: 600;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.symbol-card-count {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.62rem;
  opacity: 0.7;
  flex-shrink: 0;
}

.symbol-card-toggle {
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1;
  user-select: none;
  flex-shrink: 0;
}

.symbol-card-body {
  padding: 0.35rem 0.5rem 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.type-class {
  background-color: rgba(59, 130, 246, 0.2);
  color: rgb(147, 197, 253);
}

.type-interface {
  background-color: rgba(168, 85, 247, 0.2);
  color: rgb(216, 180, 254);
}

.member-item {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.68rem;
  line-height: 1.3;
}

.member-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.member-visibility {
  color: var(--text-secondary);
  opacity: 0.7;
  font-size: 0.62rem;
  min-width: 0.7rem;
  flex-shrink: 0;
}

.member-name {
  color: var(--text-primary);
  font-weight: 700;
  white-space: nowrap;
}

.member-type-annotation {
  color: var(--text-secondary);
  opacity: 0.8;
  white-space: nowrap;
}

.member-overflow {
  color: var(--text-secondary);
  font-size: 0.65rem;
  opacity: 0.7;
  padding: 0.15rem 0.35rem;
}

.module-entities {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.entity-item {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
  line-height: 1.3;
}

.entity-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.entity-badge {
  padding: 0.05rem 0.2rem;
  border-radius: 0.2rem;
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  text-transform: uppercase;
}

.entity-name {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-weight: 700;
  white-space: nowrap;
}

.entity-detail {
  color: var(--text-secondary);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.entity-tag {
  padding: 0.02rem 0.15rem;
  border-radius: 0.15rem;
  font-size: 0.5rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.entity-function {
  background-color: rgba(251, 191, 36, 0.2);
  color: rgb(253, 224, 71);
}

.entity-type {
  background-color: rgba(34, 197, 94, 0.2);
  color: rgb(134, 239, 172);
}

.entity-enum {
  background-color: rgba(244, 114, 182, 0.2);
  color: rgb(249, 168, 212);
}

.entity-const {
  background-color: rgba(56, 189, 248, 0.2);
  color: rgb(125, 211, 252);
}

.entity-var {
  background-color: rgba(251, 146, 60, 0.2);
  color: rgb(253, 186, 116);
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
