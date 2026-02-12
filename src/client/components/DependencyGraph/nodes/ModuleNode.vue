<script setup lang="ts">
import { computed, ref } from 'vue';

import BaseNode from './BaseNode.vue';
import CollapsibleSection from './CollapsibleSection.vue';

import type { DependencyProps, EmbeddedSymbol, ExternalDependencyRef, NodeMethod, NodeProperty } from '../types';

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);

const metadataItems = computed(() => nodeData.value.properties ?? []);
const externalDependencies = computed<ExternalDependencyRef[]>(() => {
  const metadata = nodeData.value.externalDependencies;
  return Array.isArray(metadata) ? metadata : [];
});

const embeddedSymbols = computed<EmbeddedSymbol[]>(() => {
  const symbols = nodeData.value.symbols;
  return Array.isArray(symbols) ? symbols : [];
});

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

const baseNodeProps = computed(() => ({
  id: props.id,
  type: props.type,
  data: props.data,
  ...(props.selected !== undefined ? { selected: props.selected } : {}),
  ...(props.width !== undefined ? { width: props.width } : {}),
  ...(props.height !== undefined ? { height: props.height } : {}),
  ...(props.sourcePosition !== undefined ? { sourcePosition: props.sourcePosition } : {}),
  ...(props.targetPosition !== undefined ? { targetPosition: props.targetPosition } : {}),
  isContainer: hasVueFlowChildren.value,
  showSubnodes: hasVueFlowChildren.value || hiddenSubnodeCount.value > 0,
  subnodesCount: subnodeCount.value,
}));

const showMetadata = ref(true);
const showExternalDeps = ref(true);
const showAllExternalDeps = ref(false);

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

const formatProperty = (prop: NodeProperty): { indicator: string; name: string; type: string } => ({
  indicator: visibilityIndicator(prop.visibility),
  name: prop.name,
  type: prop.type || 'unknown',
});

const formatMethod = (method: NodeMethod): { indicator: string; name: string; returnType: string } => ({
  indicator: visibilityIndicator(method.visibility),
  name: method.name,
  returnType: method.returnType || 'void',
});
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
        <button class="module-section-toggle" type="button" @click="showMetadata = !showMetadata">
          <span>Metadata</span>
          <span>{{ showMetadata ? '−' : '+' }}</span>
        </button>
        <Transition name="section-collapse">
          <div v-if="showMetadata" class="module-section-content">
            <div v-for="(prop, index) in metadataItems" :key="`metadata-${index}`" class="metadata-item">
              <span class="metadata-key">{{ prop.name }}:</span>
              <span class="metadata-value" :title="prop.type">{{ prop.type }}</span>
            </div>
          </div>
        </Transition>
      </div>

      <div v-if="externalDependencies.length > 0" class="module-section">
        <button class="module-section-toggle" type="button" @click="showExternalDeps = !showExternalDeps">
          <span>External Dependencies</span>
          <span>{{ showExternalDeps ? '−' : '+' }}</span>
        </button>
        <Transition name="section-collapse">
          <div v-if="showExternalDeps" class="module-section-content">
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
              class="dependency-more-button"
              @click="showAllExternalDeps = true"
            >
              +{{ hiddenExternalDependencyCount }} more packages
            </button>
          </div>
        </Transition>
      </div>

      <!-- Embedded symbols in compact mode -->
      <div v-if="embeddedSymbols.length > 0" class="module-symbols">
        <CollapsibleSection
          v-for="symbol in embeddedSymbols"
          :key="symbol.id"
          :title="`${symbol.type.toUpperCase()}: ${symbol.name}`"
          :count="symbol.properties.length + symbol.methods.length"
          :default-open="false"
        >
          <CollapsibleSection
            v-if="symbol.properties.length > 0"
            title="Properties"
            :count="symbol.properties.length"
            :default-open="true"
          >
            <div
              v-for="(prop, index) in symbol.properties"
              :key="`prop-${symbol.id}-${index}`"
              class="member-item"
            >
              <span class="member-visibility">{{ formatProperty(prop).indicator }}</span>
              <span class="member-name">{{ formatProperty(prop).name }}</span>
              <span class="member-type-annotation">: {{ formatProperty(prop).type }}</span>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            v-if="symbol.methods.length > 0"
            title="Methods"
            :count="symbol.methods.length"
            :default-open="true"
          >
            <div
              v-for="(method, index) in symbol.methods"
              :key="`method-${symbol.id}-${index}`"
              class="member-item"
            >
              <span class="member-visibility">{{ formatMethod(method).indicator }}</span>
              <span class="member-name">{{ formatMethod(method).name }}()</span>
              <span class="member-type-annotation">: {{ formatMethod(method).returnType }}</span>
            </div>
          </CollapsibleSection>
        </CollapsibleSection>
      </div>

      <div v-if="metadataItems.length === 0 && externalDependencies.length === 0 && embeddedSymbols.length === 0" class="module-empty-state">
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
  word-break: break-word;
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
  word-break: break-word;
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
  word-break: break-word;
}

.member-type-annotation {
  color: var(--text-secondary);
  opacity: 0.8;
  word-break: break-word;
}

.module-node--high-deps :deep(.base-node-container) {
  box-shadow:
    0 0 0 1px rgba(245, 158, 11, 0.6),
    0 0 12px rgba(245, 158, 11, 0.25);
}

.module-node--critical-deps :deep(.base-node-container) {
  box-shadow:
    0 0 0 1px rgba(239, 68, 68, 0.7),
    0 0 14px rgba(239, 68, 68, 0.3);
}

.section-collapse-enter-active,
.section-collapse-leave-active {
  transition:
    opacity 160ms ease-out,
    transform 160ms ease-out;
}

.section-collapse-enter-from,
.section-collapse-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
