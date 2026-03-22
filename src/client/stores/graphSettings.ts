import { defineStore, type SetupStoreDefinition } from 'pinia';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

export const DEFAULT_RELATIONSHIP_TYPES = [
  'import',
  'inheritance',
  'implements',
  'dependency',
  'devDependency',
  'peerDependency',
] as const;

const GRAPH_SETTINGS_CACHE_KEY = 'v2:typescript-viewer-graph-settings';

type RelationshipType = (typeof DEFAULT_RELATIONSHIP_TYPES)[number];
export type ModuleMemberType = 'function' | 'type' | 'enum' | 'const' | 'var';

export const DEFAULT_MODULE_MEMBER_TYPES: ModuleMemberType[] = ['function', 'type', 'enum', 'const', 'var'];

export interface RelationshipAvailability {
  available: boolean;
  reason?: string;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface PersistedGraphSettings {
  collapseScc?: boolean;
  clusterByFolder?: boolean;
  enabledRelationshipTypes?: string[];
  hideTestFiles?: boolean;
  highlightOrphanGlobal?: boolean;
  showFps?: boolean;
  showFpsAdvanced?: boolean;
  enabledModuleMemberTypes?: string[];
  collapsedFolderIds?: string[];
  showDebugBounds?: boolean;
  showDebugHandles?: boolean;
  showDebugNodeIds?: boolean;
}

interface GraphSettingsStore {
  collapseScc: Ref<boolean>;
  clusterByFolder: Ref<boolean>;
  enabledRelationshipTypes: Ref<string[]>;
  hideTestFiles: Ref<boolean>;
  highlightOrphanGlobal: Ref<boolean>;
  showFps: Ref<boolean>;
  showFpsAdvanced: Ref<boolean>;
  relationshipAvailability: ComputedRef<Record<RelationshipType, RelationshipAvailability>>;
  activeRelationshipTypes: ComputedRef<string[]>;
  setCollapseScc: (value: boolean) => void;
  setClusterByFolder: (value: boolean) => void;
  setEnabledRelationshipTypes: (types: string[]) => void;
  toggleRelationshipType: (type: RelationshipType, enabled: boolean) => void;
  setHideTestFiles: (value: boolean) => void;
  setHighlightOrphanGlobal: (value: boolean) => void;
  setShowFps: (value: boolean) => void;
  setShowFpsAdvanced: (value: boolean) => void;
  enabledModuleMemberTypes: Ref<string[]>;
  toggleModuleMemberType: (type: ModuleMemberType, enabled: boolean) => void;
  collapsedFolderIds: Ref<Set<string>>;
  toggleFolderCollapsed: (folderId: string) => void;
  showDebugBounds: Ref<boolean>;
  setShowDebugBounds: (value: boolean) => void;
  showDebugHandles: Ref<boolean>;
  setShowDebugHandles: (value: boolean) => void;
  showDebugNodeIds: Ref<boolean>;
  setShowDebugNodeIds: (value: boolean) => void;
}

const createGraphSettingsStore = (): GraphSettingsStore => {
  const collapseScc = ref<boolean>(true);
  const clusterByFolder = ref<boolean>(false);
  const enabledRelationshipTypes = ref<string[]>([...DEFAULT_RELATIONSHIP_TYPES]);
  const hideTestFiles = ref<boolean>(true);
  const highlightOrphanGlobal = ref<boolean>(false);
  const showFps = ref<boolean>(false);
  const showFpsAdvanced = ref<boolean>(false);
  const enabledModuleMemberTypes = ref<string[]>([...DEFAULT_MODULE_MEMBER_TYPES]);
  const collapsedFolderIds = ref<Set<string>>(new Set());
  const showDebugBounds = ref<boolean>(false);
  const showDebugHandles = ref<boolean>(false);
  const showDebugNodeIds = ref<boolean>(false);

  const relationshipAvailability = computed<Record<RelationshipType, RelationshipAvailability>>(() => {
    return {
      import: { available: true },
      inheritance: { available: true },
      implements: { available: true },
      dependency: { available: true },
      devDependency: { available: true },
      peerDependency: { available: true },
    };
  });

  const activeRelationshipTypes = computed<string[]>(() => {
    const selected = enabledRelationshipTypes.value;
    return selected.filter((type) => {
      const availability = relationshipAvailability.value[type as RelationshipType];
      return availability.available;
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
      if (typeof parsed.hideTestFiles === 'boolean') {
        hideTestFiles.value = parsed.hideTestFiles;
      }
      if (typeof parsed.highlightOrphanGlobal === 'boolean') {
        highlightOrphanGlobal.value = parsed.highlightOrphanGlobal;
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
      if (Array.isArray(parsed.collapsedFolderIds)) {
        collapsedFolderIds.value = new Set(parsed.collapsedFolderIds);
      }
      if (typeof parsed.showDebugBounds === 'boolean') {
        showDebugBounds.value = parsed.showDebugBounds;
      }
      if (typeof parsed.showDebugHandles === 'boolean') {
        showDebugHandles.value = parsed.showDebugHandles;
      }
      if (typeof parsed.showDebugNodeIds === 'boolean') {
        showDebugNodeIds.value = parsed.showDebugNodeIds;
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
        hideTestFiles: hideTestFiles.value,
        highlightOrphanGlobal: highlightOrphanGlobal.value,
        showFps: showFps.value,
        showFpsAdvanced: showFpsAdvanced.value,
        enabledModuleMemberTypes: enabledModuleMemberTypes.value,
        collapsedFolderIds: Array.from(collapsedFolderIds.value),
        showDebugBounds: showDebugBounds.value,
        showDebugHandles: showDebugHandles.value,
        showDebugNodeIds: showDebugNodeIds.value,
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

  function setHideTestFiles(value: boolean): void {
    hideTestFiles.value = value;
    persistSettings();
  }

  function setHighlightOrphanGlobal(value: boolean): void {
    highlightOrphanGlobal.value = value;
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

  function toggleFolderCollapsed(folderId: string): void {
    const next = new Set(collapsedFolderIds.value);
    if (next.has(folderId)) {
      next.delete(folderId);
    } else {
      next.add(folderId);
    }
    collapsedFolderIds.value = next;
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

  function setShowDebugBounds(value: boolean): void {
    showDebugBounds.value = value;
    persistSettings();
  }

  function setShowDebugHandles(value: boolean): void {
    showDebugHandles.value = value;
    persistSettings();
  }

  function setShowDebugNodeIds(value: boolean): void {
    showDebugNodeIds.value = value;
    persistSettings();
  }

  loadSettings();

  return {
    collapseScc,
    clusterByFolder,
    enabledRelationshipTypes,
    hideTestFiles,
    highlightOrphanGlobal,
    showFps,
    showFpsAdvanced,
    relationshipAvailability,
    activeRelationshipTypes,
    setCollapseScc,
    setClusterByFolder,
    setEnabledRelationshipTypes,
    toggleRelationshipType,
    setHideTestFiles,
    setHighlightOrphanGlobal,
    setShowFps,
    setShowFpsAdvanced,
    enabledModuleMemberTypes,
    toggleModuleMemberType,
    collapsedFolderIds,
    toggleFolderCollapsed,
    showDebugBounds,
    setShowDebugBounds,
    showDebugHandles,
    setShowDebugHandles,
    showDebugNodeIds,
    setShowDebugNodeIds,
  };
};

export const useGraphSettings: SetupStoreDefinition<
  'graphSettings',
  GraphSettingsStore
> = defineStore('graphSettings', createGraphSettingsStore);
