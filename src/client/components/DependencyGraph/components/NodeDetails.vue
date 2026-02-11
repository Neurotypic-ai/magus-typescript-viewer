<script setup lang="ts">
import { computed } from 'vue';

import { mapTypeCollection } from '../mapTypeCollection';

import type { DependencyNode, DependencyPackageGraph, GraphEdge, ModuleStructure } from '../types';

interface NodeDetailsProps {
  node: DependencyNode;
  data: DependencyPackageGraph;
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

interface DisplayMember {
  name: string;
  type: string;
  visibility?: string;
}

interface DisplayMethod {
  name: string;
  returnType: string;
  visibility?: string;
}

interface SymbolSummary {
  id: string;
  name: string;
  properties: DisplayMember[];
  methods: DisplayMethod[];
}

const props = defineProps<NodeDetailsProps>();

const nodeLabelById = computed(() => {
  const map = new Map<string, string>();
  props.nodes.forEach((node) => {
    map.set(node.id, node.data?.label ?? node.id);
  });
  return map;
});

const selectedModule = computed<ModuleStructure | undefined>(() => {
  for (const pkg of props.data.packages) {
    if (!pkg.modules) continue;
    const matched = mapTypeCollection(pkg.modules, (module) => module).find((module) => module.id === props.node.id);
    if (matched) {
      return matched;
    }
  }
  return undefined;
});

const moduleClasses = computed<SymbolSummary[]>(() => {
  const module = selectedModule.value;
  if (!module?.classes) return [];

  return mapTypeCollection(module.classes, (cls) => ({
    id: cls.id,
    name: cls.name ?? 'Unnamed class',
    properties: (cls.properties ?? []).map((prop) => ({
      name: prop.name ?? 'unnamed',
      type: prop.type ?? 'unknown',
      visibility: prop.visibility,
    })),
    methods: (cls.methods ?? []).map((method) => ({
      name: method.name ?? 'unnamed',
      returnType: method.returnType ?? 'void',
      visibility: method.visibility,
    })),
  }));
});

const moduleInterfaces = computed<SymbolSummary[]>(() => {
  const module = selectedModule.value;
  if (!module?.interfaces) return [];

  return mapTypeCollection(module.interfaces, (iface) => ({
    id: iface.id,
    name: iface.name ?? 'Unnamed interface',
    properties: (iface.properties ?? []).map((prop) => ({
      name: prop.name ?? 'unnamed',
      type: prop.type ?? 'unknown',
      visibility: prop.visibility,
    })),
    methods: (iface.methods ?? []).map((method) => ({
      name: method.name ?? 'unnamed',
      returnType: method.returnType ?? 'void',
      visibility: method.visibility,
    })),
  }));
});

function labelsFromNodeIds(ids: string[]): string[] {
  return ids.filter(Boolean).map((id) => nodeLabelById.value.get(id) ?? id);
}

const imports = computed(() => {
  const importedIds = props.edges
    .filter((edge) => edge.data?.type === 'import' && edge.source === props.node.id)
    .map((edge) => edge.target);
  return labelsFromNodeIds(importedIds);
});

const importedBy = computed(() => {
  const importerIds = props.edges
    .filter((edge) => edge.data?.type === 'import' && edge.target === props.node.id)
    .map((edge) => edge.source);
  return labelsFromNodeIds(importerIds);
});

const extendsTargets = computed(() => {
  const ids = props.edges
    .filter((edge) => edge.data?.type === 'inheritance' && edge.source === props.node.id)
    .map((edge) => edge.target);
  return labelsFromNodeIds(ids);
});

const inheritedBy = computed(() => {
  const ids = props.edges
    .filter((edge) => edge.data?.type === 'inheritance' && edge.target === props.node.id)
    .map((edge) => edge.source);
  return labelsFromNodeIds(ids);
});

const implementsTargets = computed(() => {
  const ids = props.edges
    .filter((edge) => edge.data?.type === 'implements' && edge.source === props.node.id)
    .map((edge) => edge.target);
  return labelsFromNodeIds(ids);
});

const implementedBy = computed(() => {
  const ids = props.edges
    .filter((edge) => edge.data?.type === 'implements' && edge.target === props.node.id)
    .map((edge) => edge.source);
  return labelsFromNodeIds(ids);
});

const moduleImportsMetadata = computed(() => props.node.data?.imports ?? []);
const moduleExportsMetadata = computed(() => props.node.data?.exports ?? []);
</script>

<template>
  <div
    class="fixed top-4 right-4 bg-background-paper p-5 rounded-lg border border-border-default shadow-2xl max-w-md max-h-128 overflow-y-auto"
    role="dialog"
    aria-modal="false"
    aria-labelledby="node-details-title"
  >
    <h2 id="node-details-title" class="text-xl font-bold text-text-primary mb-1">
      {{ props.node.data?.label ?? 'Unknown Node' }}
    </h2>
    <p class="text-sm text-text-secondary mb-4 pb-4 border-b border-border-default">
      Type: <span class="font-semibold text-primary-main">{{ props.node.type }}</span>
    </p>

    <div v-if="props.node.type === 'module'" class="mb-4 space-y-4">
      <div v-if="moduleClasses.length > 0">
        <strong class="text-sm font-semibold text-text-primary block mb-2">Classes</strong>
        <details v-for="cls in moduleClasses" :key="cls.id" class="ml-2 mb-2">
          <summary class="cursor-pointer text-sm text-text-primary">{{ cls.name }}</summary>
          <div class="ml-3 mt-1 space-y-1">
            <div v-if="cls.properties.length > 0" class="text-xs text-text-secondary">
              <div v-for="prop in cls.properties" :key="`${cls.id}-p-${prop.name}`">
                {{ prop.name }}: {{ prop.type }}
              </div>
            </div>
            <div v-if="cls.methods.length > 0" class="text-xs text-text-secondary">
              <div v-for="method in cls.methods" :key="`${cls.id}-m-${method.name}`">
                {{ method.name }}(): {{ method.returnType }}
              </div>
            </div>
          </div>
        </details>
      </div>

      <div v-if="moduleInterfaces.length > 0">
        <strong class="text-sm font-semibold text-text-primary block mb-2">Interfaces</strong>
        <details v-for="iface in moduleInterfaces" :key="iface.id" class="ml-2 mb-2">
          <summary class="cursor-pointer text-sm text-text-primary">{{ iface.name }}</summary>
          <div class="ml-3 mt-1 space-y-1">
            <div v-if="iface.properties.length > 0" class="text-xs text-text-secondary">
              <div v-for="prop in iface.properties" :key="`${iface.id}-p-${prop.name}`">
                {{ prop.name }}: {{ prop.type }}
              </div>
            </div>
            <div v-if="iface.methods.length > 0" class="text-xs text-text-secondary">
              <div v-for="method in iface.methods" :key="`${iface.id}-m-${method.name}`">
                {{ method.name }}(): {{ method.returnType }}
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div v-if="props.node.data?.properties && props.node.data?.properties.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Properties</strong>
      <div class="space-y-1">
        <div
          v-for="(prop, index) in props.node.data.properties"
          :key="prop.name || `prop-${index}`"
          class="text-sm text-text-secondary ml-3 font-mono"
        >
          <span class="text-primary-main">{{ prop.name ?? 'unnamed' }}</span><span class="text-text-muted">:</span>
          {{ prop.type ?? 'unknown' }}
        </div>
      </div>
    </div>

    <div v-if="props.node.data?.methods && props.node.data?.methods.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Methods</strong>
      <div class="space-y-1">
        <div
          v-for="(method, index) in props.node.data.methods"
          :key="method.name || `method-${index}`"
          class="text-sm text-text-secondary ml-3 font-mono"
        >
          <span class="text-primary-main">{{ method.name ?? 'unnamed' }}</span
          ><span class="text-text-muted">()</span><span class="text-text-muted">:</span> {{ method.returnType ?? 'void' }}
        </div>
      </div>
    </div>

    <div
      v-if="
        imports.length > 0 ||
        importedBy.length > 0 ||
        extendsTargets.length > 0 ||
        implementsTargets.length > 0 ||
        inheritedBy.length > 0 ||
        implementedBy.length > 0
      "
      class="mb-4"
    >
      <strong class="text-sm font-semibold text-text-primary block mb-2">Relationships</strong>
      <div class="space-y-2 text-xs text-text-secondary ml-2">
        <div v-if="imports.length > 0">
          <span class="text-text-primary font-semibold">Imports:</span> {{ imports.join(', ') }}
        </div>
        <div v-if="importedBy.length > 0">
          <span class="text-text-primary font-semibold">Imported by:</span> {{ importedBy.join(', ') }}
        </div>
        <div v-if="extendsTargets.length > 0">
          <span class="text-text-primary font-semibold">Extends:</span> {{ extendsTargets.join(', ') }}
        </div>
        <div v-if="implementsTargets.length > 0">
          <span class="text-text-primary font-semibold">Implements:</span> {{ implementsTargets.join(', ') }}
        </div>
        <div v-if="inheritedBy.length > 0">
          <span class="text-text-primary font-semibold">Inherited by:</span> {{ inheritedBy.join(', ') }}
        </div>
        <div v-if="implementedBy.length > 0">
          <span class="text-text-primary font-semibold">Implemented by:</span> {{ implementedBy.join(', ') }}
        </div>
      </div>
    </div>

    <div v-if="moduleImportsMetadata.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Import Paths</strong>
      <div class="space-y-1">
        <div
          v-for="(imp, index) in moduleImportsMetadata"
          :key="index"
          class="text-xs text-text-secondary ml-3 font-mono truncate"
        >
          {{ String(imp ?? '') }}
        </div>
      </div>
    </div>

    <div v-if="moduleExportsMetadata.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Exports</strong>
      <div class="space-y-1">
        <div
          v-for="(exp, index) in moduleExportsMetadata"
          :key="index"
          class="text-xs text-text-secondary ml-3 font-mono truncate"
        >
          {{ String(exp ?? '') }}
        </div>
      </div>
    </div>
  </div>
</template>
