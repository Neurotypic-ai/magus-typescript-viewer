import { defineStore } from 'pinia';
import { ref } from 'vue';

export const DEFAULT_RELATIONSHIP_TYPES = [
  'import',
  'export',
  'inheritance',
  'implements',
  'contains',
  'dependency',
  'devDependency',
  'peerDependency',
] as const;

export const DEFAULT_NODE_TYPES = ['module'] as const;

type RelationshipType = (typeof DEFAULT_RELATIONSHIP_TYPES)[number];
type NodeTypeFilter = (typeof DEFAULT_NODE_TYPES)[number] | 'class' | 'interface' | 'package';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export const useGraphSettings = defineStore('graphSettings', () => {
  const collapseScc = ref<boolean>(true);
  const clusterByFolder = ref<boolean>(false);
  const enabledRelationshipTypes = ref<string[]>([...DEFAULT_RELATIONSHIP_TYPES]);
  const enabledNodeTypes = ref<string[]>([...DEFAULT_NODE_TYPES]);

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
    setCollapseScc,
    setClusterByFolder,
    setEnabledRelationshipTypes,
    toggleRelationshipType,
    setEnabledNodeTypes,
    toggleNodeType,
  };
});
