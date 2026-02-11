import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const DEFAULT_RELATIONSHIP_TYPES = [
  'import',
  'inheritance',
  'implements',
  'dependency',
  'devDependency',
  'peerDependency',
] as const;

export const DEFAULT_NODE_TYPES = ['module'] as const;

type RelationshipType = (typeof DEFAULT_RELATIONSHIP_TYPES)[number];
type NodeTypeFilter = (typeof DEFAULT_NODE_TYPES)[number] | 'class' | 'interface' | 'package';

export interface RelationshipAvailability {
  available: boolean;
  reason?: string;
}

function createUnavailable(reason: string): RelationshipAvailability {
  return { available: false, reason };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export const useGraphSettings = defineStore('graphSettings', () => {
  const collapseScc = ref<boolean>(true);
  const clusterByFolder = ref<boolean>(false);
  const enabledRelationshipTypes = ref<string[]>([...DEFAULT_RELATIONSHIP_TYPES]);
  const enabledNodeTypes = ref<string[]>([...DEFAULT_NODE_TYPES]);

  const relationshipAvailability = computed<Record<RelationshipType, RelationshipAvailability>>(() => {
    const enabledNodeTypeSet = new Set(enabledNodeTypes.value);
    const hasModules = enabledNodeTypeSet.has('module');
    const hasPackages = enabledNodeTypeSet.has('package');
    const hasSymbols = enabledNodeTypeSet.has('class') || enabledNodeTypeSet.has('interface');

    return {
      import: hasModules ? { available: true } : createUnavailable('Requires module nodes'),
      inheritance: hasSymbols ? { available: true } : createUnavailable('Requires class or interface nodes'),
      implements: hasSymbols ? { available: true } : createUnavailable('Requires class or interface nodes'),
      dependency: hasPackages ? { available: true } : createUnavailable('Requires package nodes'),
      devDependency: hasPackages ? { available: true } : createUnavailable('Requires package nodes'),
      peerDependency: hasPackages ? { available: true } : createUnavailable('Requires package nodes'),
    };
  });

  const activeRelationshipTypes = computed<string[]>(() => {
    const selected = enabledRelationshipTypes.value;
    return selected.filter((type) => {
      const availability = relationshipAvailability.value[type as RelationshipType];
      return availability?.available ?? true;
    });
  });

  function setCollapseScc(value: boolean): void {
    collapseScc.value = value;
  }

  function setClusterByFolder(value: boolean): void {
    clusterByFolder.value = value;
  }

  function setEnabledRelationshipTypes(types: string[]): void {
    enabledRelationshipTypes.value = uniqueStrings(types);
  }

  function toggleRelationshipType(type: RelationshipType, enabled: boolean): void {
    if (enabled) {
      enabledRelationshipTypes.value = uniqueStrings([...enabledRelationshipTypes.value, type]);
      return;
    }
    enabledRelationshipTypes.value = enabledRelationshipTypes.value.filter((t) => t !== type);
  }

  function setEnabledNodeTypes(types: string[]): void {
    enabledNodeTypes.value = uniqueStrings(types);
  }

  function toggleNodeType(type: NodeTypeFilter, enabled: boolean): void {
    if (enabled) {
      enabledNodeTypes.value = uniqueStrings([...enabledNodeTypes.value, type]);
      return;
    }
    enabledNodeTypes.value = enabledNodeTypes.value.filter((t) => t !== type);
  }

  return {
    collapseScc,
    clusterByFolder,
    enabledRelationshipTypes,
    enabledNodeTypes,
    relationshipAvailability,
    activeRelationshipTypes,
    setCollapseScc,
    setClusterByFolder,
    setEnabledRelationshipTypes,
    toggleRelationshipType,
    setEnabledNodeTypes,
    toggleNodeType,
  };
});
