<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { GraphDataAssembler } from '../assemblers/GraphDataAssembler';
import { mapTypeCollection } from '../utils/collections';

import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';
import type { ModuleStructure } from '../types/ModuleStructure';

interface NodeDetailsProps {
  node: DependencyNode;
  data: DependencyPackageGraph;
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

interface DisplayMember {
  id?: string | undefined;
  name: string;
  type: string;
  visibility?: string | undefined;
  usedBy: string[];
}

interface DisplayMethod {
  id?: string | undefined;
  name: string;
  returnType: string;
  visibility?: string | undefined;
  usedBy: string[];
}

interface SymbolSummary {
  id: string;
  name: string;
  properties: DisplayMember[];
  methods: DisplayMethod[];
}

interface GraphDetailsIndex {
  moduleById: Map<string, ModuleStructure>;
  symbolToModuleId: Map<string, string>;
  usageByTargetSymbolId: Map<string, string[]>;
}

const graphDetailsIndexCache = new WeakMap<DependencyPackageGraph, GraphDetailsIndex>();
const moduleDetailsAssembler = new GraphDataAssembler();

function buildGraphDetailsIndex(data: DependencyPackageGraph): GraphDetailsIndex {
  const moduleById = new Map<string, ModuleStructure>();
  const symbolToModuleId = new Map<string, string>();
  const symbolLabelById = new Map<string, string>();
  const usageByTargetSymbolIdSets = new Map<string, Set<string>>();

  data.packages.forEach((pkg) => {
    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module) => {
      moduleById.set(module.id, module);
      symbolToModuleId.set(module.id, module.id);
      symbolLabelById.set(module.id, module.name ?? module.id);

      if (module.classes) {
        mapTypeCollection(module.classes, (cls) => {
          const classLabel = cls.name ?? 'Unnamed class';
          symbolToModuleId.set(cls.id, module.id);
          symbolLabelById.set(cls.id, classLabel);

          if (cls.properties) {
            mapTypeCollection(cls.properties, (prop) => {
              if (!prop.id) return;
              symbolToModuleId.set(prop.id, module.id);
              symbolLabelById.set(prop.id, `${classLabel}.${prop.name ?? 'unnamed'}`);
            });
          }

          if (cls.methods) {
            mapTypeCollection(cls.methods, (method) => {
              if (!method.id) return;
              symbolToModuleId.set(method.id, module.id);
              symbolLabelById.set(method.id, `${classLabel}.${method.name ?? 'unnamed'}()`);
            });
          }
        });
      }

      if (module.interfaces) {
        mapTypeCollection(module.interfaces, (iface) => {
          const interfaceLabel = iface.name ?? 'Unnamed interface';
          symbolToModuleId.set(iface.id, module.id);
          symbolLabelById.set(iface.id, interfaceLabel);

          if (iface.properties) {
            mapTypeCollection(iface.properties, (prop) => {
              if (!prop.id) return;
              symbolToModuleId.set(prop.id, module.id);
              symbolLabelById.set(prop.id, `${interfaceLabel}.${prop.name ?? 'unnamed'}`);
            });
          }

          if (iface.methods) {
            mapTypeCollection(iface.methods, (method) => {
              if (!method.id) return;
              symbolToModuleId.set(method.id, module.id);
              symbolLabelById.set(method.id, `${interfaceLabel}.${method.name ?? 'unnamed'}()`);
            });
          }
        });
      }
    });
  });

  data.packages.forEach((pkg) => {
    if (!pkg.modules) {
      return;
    }

    mapTypeCollection(pkg.modules, (module) => {
      if (!module.symbol_references) {
        return;
      }

      const moduleLabel = module.name ?? module.id;
      mapTypeCollection(module.symbol_references, (reference) => reference).forEach((reference) => {
        const targetId = reference.target_symbol_id;
        if (!targetId) {
          return;
        }

        const sourceLabelById = reference.source_symbol_id
          ? symbolLabelById.get(reference.source_symbol_id)
          : undefined;
        const sourceLabel = sourceLabelById ?? reference.source_symbol_name ?? reference.source_symbol_type;
        const usageLabel = `${sourceLabel} in ${moduleLabel}`;

        const usageSet = usageByTargetSymbolIdSets.get(targetId) ?? new Set<string>();
        usageSet.add(usageLabel);
        usageByTargetSymbolIdSets.set(targetId, usageSet);
      });
    });
  });

  const usageByTargetSymbolId = new Map<string, string[]>();
  usageByTargetSymbolIdSets.forEach((usageLabels, targetId) => {
    usageByTargetSymbolId.set(targetId, uniqueSorted(Array.from(usageLabels)));
  });

  return {
    moduleById,
    symbolToModuleId,
    usageByTargetSymbolId,
  };
}

const props = defineProps<NodeDetailsProps>();
const emit = defineEmits<{
  'open-symbol-usage': [nodeId: string];
}>();

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

const graphDetailsIndex = computed<GraphDetailsIndex>(() => {
  const cached = graphDetailsIndexCache.get(props.data);
  if (cached) {
    return cached;
  }

  const index = buildGraphDetailsIndex(props.data);
  graphDetailsIndexCache.set(props.data, index);
  return index;
});

const hydratedModule = ref<ModuleStructure | null>(null);
const hydratedModuleId = ref<string | null>(null);
const isHydratingDetails = ref(false);
const detailsLoadError = ref<string | null>(null);

const activeModuleId = computed<string | null>(() => {
  if (props.node.type === 'module') {
    return props.node.id;
  }

  const parentId = props.node.data?.parentId;
  if (typeof parentId === 'string' && parentId.length > 0) {
    return parentId;
  }

  return graphDetailsIndex.value.symbolToModuleId.get(props.node.id) ?? null;
});

watch(
  activeModuleId,
  (moduleId, _prev, onCleanup) => {
    if (!moduleId) {
      hydratedModule.value = null;
      hydratedModuleId.value = null;
      detailsLoadError.value = null;
      isHydratingDetails.value = false;
      return;
    }

    if (hydratedModuleId.value === moduleId && !detailsLoadError.value) {
      isHydratingDetails.value = false;
      return;
    }

    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    isHydratingDetails.value = true;
    detailsLoadError.value = null;

    void moduleDetailsAssembler
      .fetchModuleDetails(moduleId)
      .then((moduleDetails) => {
        if (cancelled) return;
        hydratedModuleId.value = moduleId;
        hydratedModule.value = moduleDetails;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        detailsLoadError.value = error instanceof Error ? error.message : 'Failed to load module details.';
      })
      .finally(() => {
        if (cancelled) return;
        isHydratingDetails.value = false;
      });
  },
  { immediate: true }
);

const nodeLabelById = computed(() => {
  const map = new Map<string, string>();
  props.nodes.forEach((node) => {
    map.set(node.id, node.data?.label ?? node.id);
  });
  return map;
});

// Pre-compute edge indexes once instead of filtering all edges 6+ times
const edgesBySource = computed(() => {
  const map = new Map<string, GraphEdge[]>();
  for (const edge of props.edges) {
    const existing = map.get(edge.source);
    if (existing) existing.push(edge);
    else map.set(edge.source, [edge]);
  }
  return map;
});

const edgesByTarget = computed(() => {
  const map = new Map<string, GraphEdge[]>();
  for (const edge of props.edges) {
    const existing = map.get(edge.target);
    if (existing) existing.push(edge);
    else map.set(edge.target, [edge]);
  }
  return map;
});

function getUsedBy(symbolId: string | undefined): string[] {
  if (!symbolId) return [];
  return graphDetailsIndex.value.usageByTargetSymbolId.get(symbolId) ?? [];
}

const selectedModule = computed<ModuleStructure | undefined>(() => {
  const moduleId = activeModuleId.value;
  if (!moduleId) {
    return undefined;
  }

  if (hydratedModuleId.value === moduleId && hydratedModule.value) {
    return hydratedModule.value;
  }

  return graphDetailsIndex.value.moduleById.get(moduleId);
});

const moduleClasses = computed<SymbolSummary[]>(() => {
  const module = selectedModule.value;
  if (!module?.classes) return [];

  return mapTypeCollection(module.classes, (cls) => ({
    id: cls.id,
    name: cls.name ?? 'Unnamed class',
    properties: (cls.properties ?? []).map((prop) => ({
      id: prop.id,
      name: prop.name ?? 'unnamed',
      type: prop.type ?? 'unknown',
      visibility: prop.visibility,
      usedBy: getUsedBy(prop.id),
    })),
    methods: (cls.methods ?? []).map((method) => ({
      id: method.id,
      name: method.name ?? 'unnamed',
      returnType: method.returnType ?? 'void',
      visibility: method.visibility,
      usedBy: getUsedBy(method.id),
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
      id: prop.id,
      name: prop.name ?? 'unnamed',
      type: prop.type ?? 'unknown',
      visibility: prop.visibility,
      usedBy: getUsedBy(prop.id),
    })),
    methods: (iface.methods ?? []).map((method) => ({
      id: method.id,
      name: method.name ?? 'unnamed',
      returnType: method.returnType ?? 'void',
      visibility: method.visibility,
      usedBy: getUsedBy(method.id),
    })),
  }));
});

const hydratedSymbolDetails = computed(() => {
  if (!selectedModule.value) {
    return null;
  }

  if (selectedModule.value.classes) {
    const cls = mapTypeCollection(selectedModule.value.classes, (entry) => entry).find((entry) => entry.id === props.node.id);
    if (cls) {
      return {
        properties: Array.isArray(cls.properties) ? cls.properties : [],
        methods: Array.isArray(cls.methods) ? cls.methods : [],
      };
    }
  }

  if (selectedModule.value.interfaces) {
    const iface = mapTypeCollection(selectedModule.value.interfaces, (entry) => entry).find((entry) => entry.id === props.node.id);
    if (iface) {
      return {
        properties: Array.isArray(iface.properties) ? iface.properties : [],
        methods: Array.isArray(iface.methods) ? iface.methods : [],
      };
    }
  }

  return null;
});

const nodeProperties = computed<DisplayMember[]>(() => {
  const nodeProperties = Array.isArray(props.node.data?.properties) ? props.node.data.properties : [];
  const properties = nodeProperties.length > 0 ? nodeProperties : (hydratedSymbolDetails.value?.properties ?? []);
  return properties.map((prop) => ({
    id: prop.id,
    name: prop.name ?? 'unnamed',
    type: prop.type ?? 'unknown',
    visibility: prop.visibility,
    usedBy: getUsedBy(prop.id),
  }));
});

const nodeMethods = computed<DisplayMethod[]>(() => {
  const nodeMethods = Array.isArray(props.node.data?.methods) ? props.node.data.methods : [];
  const methods = nodeMethods.length > 0 ? nodeMethods : (hydratedSymbolDetails.value?.methods ?? []);
  return methods.map((method) => ({
    id: method.id,
    name: method.name ?? 'unnamed',
    returnType: method.returnType ?? 'void',
    visibility: method.visibility,
    usedBy: getUsedBy(method.id),
  }));
});

function labelsFromNodeIds(ids: string[]): string[] {
  const labels = ids.filter(Boolean).map((id) => nodeLabelById.value.get(id) ?? id);
  return uniqueSorted(labels);
}

const nodeRelationships = computed(() => {
  const outgoingByType = new Map<string, string[]>();
  const incomingByType = new Map<string, string[]>();

  const sourceEdges = edgesBySource.value.get(props.node.id) ?? [];
  sourceEdges.forEach((edge) => {
    const edgeType = edge.data?.type;
    if (!edgeType) {
      return;
    }
    const targets = outgoingByType.get(edgeType) ?? [];
    targets.push(edge.target);
    outgoingByType.set(edgeType, targets);
  });

  const targetEdges = edgesByTarget.value.get(props.node.id) ?? [];
  targetEdges.forEach((edge) => {
    const edgeType = edge.data?.type;
    if (!edgeType) {
      return;
    }
    const sources = incomingByType.get(edgeType) ?? [];
    sources.push(edge.source);
    incomingByType.set(edgeType, sources);
  });

  return {
    outgoingByType,
    incomingByType,
  };
});

function labelsForOutgoingType(type: string): string[] {
  return labelsFromNodeIds(nodeRelationships.value.outgoingByType.get(type) ?? []);
}

function labelsForIncomingType(type: string): string[] {
  return labelsFromNodeIds(nodeRelationships.value.incomingByType.get(type) ?? []);
}

const imports = computed(() => labelsForOutgoingType('import'));
const importedBy = computed(() => labelsForIncomingType('import'));
const extendsTargets = computed(() => labelsForOutgoingType('inheritance'));
const inheritedBy = computed(() => labelsForIncomingType('inheritance'));
const implementsTargets = computed(() => labelsForOutgoingType('implements'));
const implementedBy = computed(() => labelsForIncomingType('implements'));

const moduleImportsMetadata = computed(() => props.node.data?.imports ?? []);
const moduleExportsMetadata = computed(() => props.node.data?.exports ?? []);

interface ExternalImportGroup {
  packageName: string;
  specifiers: string[];
}

function isExternalImportPath(path: string): boolean {
  if (path.startsWith('./') || path.startsWith('../') || path.startsWith('/') || path.startsWith('@/') || path.startsWith('src/')) {
    return false;
  }
  return true;
}

const externalImports = computed<ExternalImportGroup[]>(() => {
  const module = selectedModule.value;
  if (!module) {
    return [];
  }

  const metadataExternalDependencies = (module as { externalDependencies?: unknown }).externalDependencies;
  if (Array.isArray(metadataExternalDependencies)) {
    return metadataExternalDependencies
      .filter((dependency): dependency is { packageName: string; symbols: string[] } => {
        if (!dependency || typeof dependency !== 'object') return false;
        const entry = dependency as { packageName?: unknown; symbols?: unknown };
        return typeof entry.packageName === 'string' && Array.isArray(entry.symbols);
      })
      .map((dependency) => ({
        packageName: dependency.packageName,
        specifiers: dependency.symbols,
      }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName));
  }

  if (!module.imports) {
    return [];
  }

  const grouped = new Map<string, Set<string>>();

  mapTypeCollection(module.imports, (imp) => imp).forEach((imp) => {
    const packageName = imp.packageName ?? (typeof imp.path === 'string' && isExternalImportPath(imp.path) ? imp.path : undefined);
    const isExternal = imp.isExternal ?? Boolean(packageName);
    if (!isExternal || !packageName) {
      return;
    }

    const existing = grouped.get(packageName) ?? new Set<string>();

    if (Array.isArray(imp.specifiers)) {
      imp.specifiers.forEach((specifier) => {
        const label = specifier.local && specifier.local !== specifier.imported
          ? `${specifier.imported} as ${specifier.local}`
          : specifier.imported;
        if (label.length > 0) {
          existing.add(label);
        }
      });
    } else if (imp.name) {
      existing.add(imp.name);
    } else {
      existing.add('(side-effect)');
    }

    grouped.set(packageName, existing);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([packageName, specifiers]) => ({
      packageName,
      specifiers: Array.from(specifiers).sort((a, b) => a.localeCompare(b)),
    }));
});

const canOpenSymbolUsageGraph = computed(() => ['module', 'class', 'interface'].includes(String(props.node.type ?? '')));

const openSymbolUsageGraph = () => {
  emit('open-symbol-usage', props.node.id);
};
</script>

<template>
  <div
    data-graph-overlay-scrollable
    class="nowheel absolute top-14 right-4 z-50 bg-background-paper p-5 rounded-lg border border-border-default shadow-2xl max-w-md max-h-128 overflow-y-auto"
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

    <p
      v-if="isHydratingDetails"
      role="status"
      aria-live="polite"
      class="text-xs text-text-secondary mb-3"
    >
      Loading module details...
    </p>
    <p
      v-else-if="detailsLoadError"
      role="alert"
      aria-live="assertive"
      class="text-xs text-red-300 mb-3"
    >
      {{ detailsLoadError }}
    </p>

    <button
      v-if="canOpenSymbolUsageGraph"
      type="button"
      @click="openSymbolUsageGraph"
      class="w-full mb-4 px-3 py-2 bg-primary-main/20 text-primary-main border border-primary-main/30 rounded hover:bg-primary-main/30 transition-fast text-xs font-semibold"
    >
      Open Symbol Usage Graph
    </button>

    <div v-if="props.node.type === 'module'" class="mb-4 space-y-4">
      <div v-if="moduleClasses.length > 0">
        <strong class="text-sm font-semibold text-text-primary block mb-2">Classes</strong>
        <details v-for="cls in moduleClasses" :key="cls.id" class="ml-2 mb-2">
          <summary class="cursor-pointer text-sm text-text-primary">{{ cls.name }}</summary>
          <div class="ml-3 mt-1 space-y-1">
            <div v-if="cls.properties.length > 0" class="text-xs text-text-secondary">
              <div v-for="(prop, propIndex) in cls.properties" :key="prop.id ?? `${cls.id}-p-${propIndex}`">
                {{ prop.name }}: {{ prop.type }}
                <div v-if="prop.usedBy.length > 0" class="ml-2 text-[11px] text-text-muted">
                  used by: {{ prop.usedBy.join(', ') }}
                </div>
              </div>
            </div>
            <div v-if="cls.methods.length > 0" class="text-xs text-text-secondary">
              <div v-for="(method, methodIndex) in cls.methods" :key="method.id ?? `${cls.id}-m-${methodIndex}`">
                {{ method.name }}(): {{ method.returnType }}
                <div v-if="method.usedBy.length > 0" class="ml-2 text-[11px] text-text-muted">
                  used by: {{ method.usedBy.join(', ') }}
                </div>
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
              <div v-for="(prop, propIndex) in iface.properties" :key="prop.id ?? `${iface.id}-p-${propIndex}`">
                {{ prop.name }}: {{ prop.type }}
                <div v-if="prop.usedBy.length > 0" class="ml-2 text-[11px] text-text-muted">
                  used by: {{ prop.usedBy.join(', ') }}
                </div>
              </div>
            </div>
            <div v-if="iface.methods.length > 0" class="text-xs text-text-secondary">
              <div v-for="(method, methodIndex) in iface.methods" :key="method.id ?? `${iface.id}-m-${methodIndex}`">
                {{ method.name }}(): {{ method.returnType }}
                <div v-if="method.usedBy.length > 0" class="ml-2 text-[11px] text-text-muted">
                  used by: {{ method.usedBy.join(', ') }}
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div v-if="nodeProperties.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Properties</strong>
      <div class="space-y-1">
        <div
          v-for="(prop, index) in nodeProperties"
          :key="prop.id ?? `prop-${index}`"
          class="text-sm text-text-secondary ml-3 font-mono"
        >
          <span class="text-primary-main">{{ prop.name }}</span><span class="text-text-muted">:</span>
          {{ prop.type }}
          <div v-if="prop.usedBy.length > 0" class="text-xs text-text-muted ml-1">
            used by: {{ prop.usedBy.join(', ') }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="nodeMethods.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Methods</strong>
      <div class="space-y-1">
        <div
          v-for="(method, index) in nodeMethods"
          :key="method.id ?? `method-${index}`"
          class="text-sm text-text-secondary ml-3 font-mono"
        >
          <span class="text-primary-main">{{ method.name }}</span><span class="text-text-muted">()</span
          ><span class="text-text-muted">:</span> {{ method.returnType }}
          <div v-if="method.usedBy.length > 0" class="text-xs text-text-muted ml-1">
            used by: {{ method.usedBy.join(', ') }}
          </div>
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

    <div v-if="externalImports.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">External Imports</strong>
      <div class="space-y-2">
        <div v-for="group in externalImports" :key="group.packageName" class="ml-2">
          <div class="text-xs font-semibold text-primary-main">{{ group.packageName }}</div>
          <div class="text-xs text-text-secondary ml-2">
            {{ group.specifiers.join(', ') }}
          </div>
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
