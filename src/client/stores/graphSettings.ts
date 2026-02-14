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
const GRAPH_SETTINGS_CACHE_KEY = 'v1:typescript-viewer-graph-settings';

type RelationshipType = (typeof DEFAULT_RELATIONSHIP_TYPES)[number];
type NodeTypeFilter = (typeof DEFAULT_NODE_TYPES)[number] | 'class' | 'interface' | 'package';
export type ModuleMemberType = 'function' | 'type' | 'enum' | 'const' | 'var';
type MemberNodeMode = 'compact' | 'graph';

export const DEFAULT_MODULE_MEMBER_TYPES: ModuleMemberType[] = ['function', 'type', 'enum', 'const', 'var'];

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

interface PersistedGraphSettings {
  collapseScc?: boolean;
  clusterByFolder?: boolean;
  enabledRelationshipTypes?: string[];
  enabledNodeTypes?: string[];
  hideTestFiles?: boolean;
  memberNodeMode?: MemberNodeMode;
  highlightOrphanGlobal?: boolean;
  degreeWeightedLayers?: boolean;
  showFps?: boolean;
  showFpsAdvanced?: boolean;
  enabledModuleMemberTypes?: string[];
}

export const useGraphSettings = defineStore('graphSettings', () => {
  const collapseScc = ref<boolean>(true);
  const clusterByFolder = ref<boolean>(false);
  const enabledRelationshipTypes = ref<string[]>([...DEFAULT_RELATIONSHIP_TYPES]);
  const enabledNodeTypes = ref<string[]>([...DEFAULT_NODE_TYPES]);
  const hideTestFiles = ref<boolean>(true);
  const memberNodeMode = ref<MemberNodeMode>('compact');
  const highlightOrphanGlobal = ref<boolean>(false);
  const degreeWeightedLayers = ref<boolean>(false);
  const showFps = ref<boolean>(false);
  const showFpsAdvanced = ref<boolean>(false);
  const enabledModuleMemberTypes = ref<string[]>([...DEFAULT_MODULE_MEMBER_TYPES]);

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

  const loadSettings = (): void => {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const raw = localStorage.getItem(GRAPH_SETTINGS_CACHE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as PersistedGraphSettings;
      if (typeof parsed.collapseScc === 'boolean') {
        collapseScc.value = parsed.collapseScc;
      }
      if (typeof parsed.clusterByFolder === 'boolean') {
        clusterByFolder.value = parsed.clusterByFolder;
      }
      if (Array.isArray(parsed.enabledRelationshipTypes)) {
        enabledRelationshipTypes.value = uniqueStrings(parsed.enabledRelationshipTypes);
      }
      if (Array.isArray(parsed.enabledNodeTypes)) {
        enabledNodeTypes.value = uniqueStrings(parsed.enabledNodeTypes);
      }
      if (typeof parsed.hideTestFiles === 'boolean') {
        hideTestFiles.value = parsed.hideTestFiles;
      }
      if (parsed.memberNodeMode === 'compact' || parsed.memberNodeMode === 'graph') {
        memberNodeMode.value = parsed.memberNodeMode;
      }
      if (typeof parsed.highlightOrphanGlobal === 'boolean') {
        highlightOrphanGlobal.value = parsed.highlightOrphanGlobal;
      }
      if (typeof parsed.degreeWeightedLayers === 'boolean') {
        degreeWeightedLayers.value = parsed.degreeWeightedLayers;
      }
      if (typeof parsed.showFps === 'boolean') {
        showFps.value = parsed.showFps;
      }
      if (typeof parsed.showFpsAdvanced === 'boolean') {
        showFpsAdvanced.value = parsed.showFpsAdvanced;
      }
      if (Array.isArray(parsed.enabledModuleMemberTypes)) {
        enabledModuleMemberTypes.value = uniqueStrings(parsed.enabledModuleMemberTypes);
      }
    } catch {
      // Ignore persisted settings parse failures.
    }
  };

  const persistSettings = (): void => {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const payload: PersistedGraphSettings = {
        collapseScc: collapseScc.value,
        clusterByFolder: clusterByFolder.value,
        enabledRelationshipTypes: enabledRelationshipTypes.value,
        enabledNodeTypes: enabledNodeTypes.value,
        hideTestFiles: hideTestFiles.value,
        memberNodeMode: memberNodeMode.value,
        highlightOrphanGlobal: highlightOrphanGlobal.value,
        degreeWeightedLayers: degreeWeightedLayers.value,
        showFps: showFps.value,
        showFpsAdvanced: showFpsAdvanced.value,
        enabledModuleMemberTypes: enabledModuleMemberTypes.value,
      };
      localStorage.setItem(GRAPH_SETTINGS_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore persisted settings write failures.
    }
  };

  function setCollapseScc(value: boolean): void {
    collapseScc.value = value;
    persistSettings();
  }

  function setClusterByFolder(value: boolean): void {
    clusterByFolder.value = value;
    persistSettings();
  }

  function setEnabledRelationshipTypes(types: string[]): void {
    enabledRelationshipTypes.value = uniqueStrings(types);
    persistSettings();
  }

  function toggleRelationshipType(type: RelationshipType, enabled: boolean): void {
    if (enabled) {
      enabledRelationshipTypes.value = uniqueStrings([...enabledRelationshipTypes.value, type]);
      persistSettings();
      return;
    }
    enabledRelationshipTypes.value = enabledRelationshipTypes.value.filter((t) => t !== type);
    persistSettings();
  }

  function setEnabledNodeTypes(types: string[]): void {
    enabledNodeTypes.value = uniqueStrings(types);
    persistSettings();
  }

  function toggleNodeType(type: NodeTypeFilter, enabled: boolean): void {
    if (enabled) {
      enabledNodeTypes.value = uniqueStrings([...enabledNodeTypes.value, type]);
      persistSettings();
      return;
    }
    enabledNodeTypes.value = enabledNodeTypes.value.filter((t) => t !== type);
    persistSettings();
  }

  function setHideTestFiles(value: boolean): void {
    hideTestFiles.value = value;
    persistSettings();
  }

  function setMemberNodeMode(value: MemberNodeMode): void {
    memberNodeMode.value = value;
    persistSettings();
  }

  function setHighlightOrphanGlobal(value: boolean): void {
    highlightOrphanGlobal.value = value;
    persistSettings();
  }

  function setDegreeWeightedLayers(value: boolean): void {
    degreeWeightedLayers.value = value;
    persistSettings();
  }

  function setShowFps(value: boolean): void {
    showFps.value = value;
    persistSettings();
  }

  function setShowFpsAdvanced(value: boolean): void {
    showFpsAdvanced.value = value;
    persistSettings();
  }

  function toggleModuleMemberType(type: ModuleMemberType, enabled: boolean): void {
    if (enabled) {
      enabledModuleMemberTypes.value = uniqueStrings([...enabledModuleMemberTypes.value, type]);
      persistSettings();
      return;
    }
    enabledModuleMemberTypes.value = enabledModuleMemberTypes.value.filter((t) => t !== type);
    persistSettings();
  }

  loadSettings();

  return {
    collapseScc,
    clusterByFolder,
    enabledRelationshipTypes,
    enabledNodeTypes,
    hideTestFiles,
    memberNodeMode,
    highlightOrphanGlobal,
    degreeWeightedLayers,
    showFps,
    showFpsAdvanced,
    relationshipAvailability,
    activeRelationshipTypes,
    setCollapseScc,
    setClusterByFolder,
    setEnabledRelationshipTypes,
    toggleRelationshipType,
    setEnabledNodeTypes,
    toggleNodeType,
    setHideTestFiles,
    setMemberNodeMode,
    setHighlightOrphanGlobal,
    setDegreeWeightedLayers,
    setShowFps,
    setShowFpsAdvanced,
    enabledModuleMemberTypes,
    toggleModuleMemberType,
  };
});
