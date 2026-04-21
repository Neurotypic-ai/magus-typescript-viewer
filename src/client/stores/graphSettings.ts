import { computed, ref } from 'vue';

import { defineStore } from 'pinia';

import type { SetupStoreDefinition } from 'pinia';
import type { ComputedRef, Ref } from 'vue';

/**
 * Relationship types surfaced in the overview-level filter UI.
 *
 * The full `DependencyEdgeKind` taxonomy includes `export`, `uses`, and
 * `contains`, but those are symbol-level edges that only make sense in a
 * drill-down view; at module-overview scale they duplicate `import` or
 * produce noise. They stay in the enum and registry (still emitted for
 * drill-down graphs and tests) but are not user-toggleable here.
 */
export const DEFAULT_RELATIONSHIP_TYPES = [
  'dependency',
  'devDependency',
  'peerDependency',
  'import',
  'extends',
  'implements',
] as const;

// Bumped from v2 to v3 when DEFAULT_RELATIONSHIP_TYPES changed shape:
// - Removed: inheritance, export, uses, contains
// - Promoted to overview-level: dependency, devDependency, peerDependency
// Without bumping the key, users with saved v2 prefs would never see the new
// dependency-scope edges because their persisted enabledRelationshipTypes
// would silently filter them out.
const GRAPH_SETTINGS_CACHE_KEY = 'v3:typescript-viewer-graph-settings';

type RelationshipType = (typeof DEFAULT_RELATIONSHIP_TYPES)[number];

interface RelationshipAvailability {
  available: boolean;
  reason?: string;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface PersistedGraphSettings {
  enabledRelationshipTypes?: string[];
  hideTestFiles?: boolean;
  highlightOrphanGlobal?: boolean;
  showFps?: boolean;
  showFpsAdvanced?: boolean;
  collapsedFolderIds?: string[];
  showDebugNodeIds?: boolean;
}

interface GraphSettingsStore {
  enabledRelationshipTypes: Ref<string[]>;
  hideTestFiles: Ref<boolean>;
  highlightOrphanGlobal: Ref<boolean>;
  showFps: Ref<boolean>;
  showFpsAdvanced: Ref<boolean>;
  relationshipAvailability: ComputedRef<Record<RelationshipType, RelationshipAvailability>>;
  activeRelationshipTypes: ComputedRef<string[]>;
  setEnabledRelationshipTypes: (types: string[]) => void;
  toggleRelationshipType: (type: RelationshipType, enabled: boolean) => void;
  setHideTestFiles: (value: boolean) => void;
  setHighlightOrphanGlobal: (value: boolean) => void;
  setShowFps: (value: boolean) => void;
  setShowFpsAdvanced: (value: boolean) => void;
  collapsedFolderIds: Ref<Set<string>>;
  toggleFolderCollapsed: (folderId: string) => void;
  showDebugNodeIds: Ref<boolean>;
  setShowDebugNodeIds: (value: boolean) => void;
}

const createGraphSettingsStore = (): GraphSettingsStore => {
  const enabledRelationshipTypes = ref<string[]>([...DEFAULT_RELATIONSHIP_TYPES]);
  const hideTestFiles = ref<boolean>(true);
  const highlightOrphanGlobal = ref<boolean>(false);
  const showFps = ref<boolean>(false);
  const showFpsAdvanced = ref<boolean>(false);
  const collapsedFolderIds = ref<Set<string>>(new Set());
  const showDebugNodeIds = ref<boolean>(false);

  const relationshipAvailability = computed<Record<RelationshipType, RelationshipAvailability>>(() => {
    return {
      dependency: { available: true },
      devDependency: { available: true },
      peerDependency: { available: true },
      import: { available: true },
      extends: { available: true },
      implements: { available: true },
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
      if (Array.isArray(parsed.collapsedFolderIds)) {
        collapsedFolderIds.value = new Set(parsed.collapsedFolderIds);
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
        enabledRelationshipTypes: enabledRelationshipTypes.value,
        hideTestFiles: hideTestFiles.value,
        highlightOrphanGlobal: highlightOrphanGlobal.value,
        showFps: showFps.value,
        showFpsAdvanced: showFpsAdvanced.value,
        collapsedFolderIds: Array.from(collapsedFolderIds.value),
        showDebugNodeIds: showDebugNodeIds.value,
      };
      localStorage.setItem(GRAPH_SETTINGS_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore persisted settings write failures.
    }
  };

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

  function setShowDebugNodeIds(value: boolean): void {
    showDebugNodeIds.value = value;
    persistSettings();
  }

  loadSettings();

  return {
    enabledRelationshipTypes,
    hideTestFiles,
    highlightOrphanGlobal,
    showFps,
    showFpsAdvanced,
    relationshipAvailability,
    activeRelationshipTypes,
    setEnabledRelationshipTypes,
    toggleRelationshipType,
    setHideTestFiles,
    setHighlightOrphanGlobal,
    setShowFps,
    setShowFpsAdvanced,
    collapsedFolderIds,
    toggleFolderCollapsed,
    showDebugNodeIds,
    setShowDebugNodeIds,
  };
};

export const useGraphSettings: SetupStoreDefinition<'graphSettings', GraphSettingsStore> = defineStore(
  'graphSettings',
  createGraphSettingsStore
);
