import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { isRenderingStrategyId, type RenderingStrategyId, type RenderingStrategyOptionsById } from '../rendering/RenderingStrategy';
import { createDefaultStrategyOptionsById, sanitizeStrategyOptionsById } from '../rendering/strategyRegistry';

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
export const GRAPH_CONTROL_SECTION_KEYS = [
  'nodeTypes',
  'renderingStrategy',
  'analysis',
  'moduleSections',
  'memberDisplay',
  'relationshipTypes',
  'performance',
  'debug',
] as const;

type RelationshipType = (typeof DEFAULT_RELATIONSHIP_TYPES)[number];
type NodeTypeFilter = (typeof DEFAULT_NODE_TYPES)[number] | 'class' | 'interface' | 'package';
export type ModuleMemberType = 'function' | 'type' | 'enum' | 'const' | 'var';
type MemberNodeMode = 'compact' | 'graph';
type LegacyEdgeRendererMode = 'hybrid-canvas' | 'vue-flow';
export type GraphControlSectionKey = (typeof GRAPH_CONTROL_SECTION_KEYS)[number];

export const DEFAULT_MODULE_MEMBER_TYPES: ModuleMemberType[] = ['function', 'type', 'enum', 'const', 'var'];

const LEGACY_EDGE_RENDERER_MODE_TO_STRATEGY_ID: Record<LegacyEdgeRendererMode, RenderingStrategyId> = {
  'hybrid-canvas': 'canvas',
  'vue-flow': 'vueflow',
};

const STRATEGY_ID_TO_LEGACY_EDGE_RENDERER_MODE: Record<RenderingStrategyId, LegacyEdgeRendererMode> = {
  canvas: 'hybrid-canvas',
  vueflow: 'vue-flow',
  folderDistributor: 'vue-flow',
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createDefaultCollapsedSections(): Record<GraphControlSectionKey, boolean> {
  return GRAPH_CONTROL_SECTION_KEYS.reduce(
    (acc, key) => {
      acc[key] = false;
      return acc;
    },
    {} as Record<GraphControlSectionKey, boolean>
  );
}

function isGraphControlSectionKey(value: string): value is GraphControlSectionKey {
  return (GRAPH_CONTROL_SECTION_KEYS as readonly string[]).includes(value);
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
  renderingStrategyId?: RenderingStrategyId;
  strategyOptionsById?: RenderingStrategyOptionsById;
  edgeRendererMode?: LegacyEdgeRendererMode;
  enabledModuleMemberTypes?: string[];
  collapsedFolderIds?: string[];
  collapsedSections?: Record<string, boolean>;
  showDebugBounds?: boolean;
  showDebugHandles?: boolean;
  showDebugNodeIds?: boolean;
}

export const useGraphSettings = defineStore('graphSettings', () => {
  const collapseScc = ref<boolean>(true);
  const clusterByFolder = ref<boolean>(false);
  const enabledRelationshipTypes = ref<string[]>([...DEFAULT_RELATIONSHIP_TYPES]);
  const enabledNodeTypes = ref<string[]>([...DEFAULT_NODE_TYPES]);
  const hideTestFiles = ref<boolean>(true);
  const memberNodeMode = ref<MemberNodeMode>('compact');
  const highlightOrphanGlobal = ref<boolean>(false);
  const showFps = ref<boolean>(false);
  const showFpsAdvanced = ref<boolean>(false);
  const renderingStrategyId = ref<RenderingStrategyId>('canvas');
  const strategyOptionsById = ref<RenderingStrategyOptionsById>(createDefaultStrategyOptionsById());
  const enabledModuleMemberTypes = ref<string[]>([...DEFAULT_MODULE_MEMBER_TYPES]);
  const collapsedFolderIds = ref<Set<string>>(new Set());
  const collapsedSections = ref<Record<GraphControlSectionKey, boolean>>(createDefaultCollapsedSections());
  const showDebugBounds = ref<boolean>(false);
  const showDebugHandles = ref<boolean>(false);
  const showDebugNodeIds = ref<boolean>(false);
  let hasPersistedRenderingStrategyId = false;

  const relationshipAvailability = computed<Record<RelationshipType, RelationshipAvailability>>(() => {
    const enabledNodeTypeSet = new Set(enabledNodeTypes.value);
    const hasModules = enabledNodeTypeSet.has('module');
    const hasPackages = enabledNodeTypeSet.has('package');
    const hasSymbols = enabledNodeTypeSet.has('class') || enabledNodeTypeSet.has('interface');

    return {
      import: hasModules ? { available: true } : createUnavailable('Requires module nodes'),
      inheritance:
        hasSymbols || hasModules
          ? { available: true }
          : createUnavailable('Requires module, class, or interface nodes'),
      implements:
        hasSymbols || hasModules
          ? { available: true }
          : createUnavailable('Requires module, class, or interface nodes'),
      dependency: hasPackages ? { available: true } : createUnavailable('Requires package nodes'),
      devDependency: hasPackages ? { available: true } : createUnavailable('Requires package nodes'),
      peerDependency: hasPackages ? { available: true } : createUnavailable('Requires package nodes'),
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
      // Migrate legacy degreeWeightedLayers into strategy options for canvas+vueflow before sanitize
      let optionsToSanitize = parsed.strategyOptionsById;
      if (typeof parsed.degreeWeightedLayers === 'boolean') {
        const canvasOptions = isRecord(parsed.strategyOptionsById?.canvas) ? parsed.strategyOptionsById.canvas : {};
        const vueflowOptions = isRecord(parsed.strategyOptionsById?.vueflow) ? parsed.strategyOptionsById.vueflow : {};
        const migrated = {
          canvas: { ...canvasOptions, degreeWeightedLayers: parsed.degreeWeightedLayers },
          vueflow: { ...vueflowOptions, degreeWeightedLayers: parsed.degreeWeightedLayers },
          folderDistributor: parsed.strategyOptionsById?.folderDistributor ?? {},
        };
        optionsToSanitize = migrated as RenderingStrategyOptionsById;
      }
      if (typeof parsed.showFps === 'boolean') {
        showFps.value = parsed.showFps;
      }
      if (typeof parsed.showFpsAdvanced === 'boolean') {
        showFpsAdvanced.value = parsed.showFpsAdvanced;
      }
      if (isRenderingStrategyId(parsed.renderingStrategyId)) {
        renderingStrategyId.value = parsed.renderingStrategyId;
        hasPersistedRenderingStrategyId = true;
      } else if (parsed.edgeRendererMode === 'hybrid-canvas' || parsed.edgeRendererMode === 'vue-flow') {
        renderingStrategyId.value = LEGACY_EDGE_RENDERER_MODE_TO_STRATEGY_ID[parsed.edgeRendererMode];
        hasPersistedRenderingStrategyId = true;
      }
      strategyOptionsById.value = sanitizeStrategyOptionsById(optionsToSanitize);
      if (Array.isArray(parsed.enabledModuleMemberTypes)) {
        enabledModuleMemberTypes.value = uniqueStrings(parsed.enabledModuleMemberTypes);
      }
      if (Array.isArray(parsed.collapsedFolderIds)) {
        collapsedFolderIds.value = new Set(parsed.collapsedFolderIds);
      }
      if (isRecord(parsed.collapsedSections)) {
        const nextCollapsedSections = createDefaultCollapsedSections();
        for (const [key, rawValue] of Object.entries(parsed.collapsedSections)) {
          if (!isGraphControlSectionKey(key) || typeof rawValue !== 'boolean') {
            continue;
          }
          nextCollapsedSections[key] = rawValue;
        }
        collapsedSections.value = nextCollapsedSections;
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
      const legacyEdgeRendererMode = STRATEGY_ID_TO_LEGACY_EDGE_RENDERER_MODE[renderingStrategyId.value];
      const payload: Omit<PersistedGraphSettings, 'degreeWeightedLayers'> = {
        collapseScc: collapseScc.value,
        clusterByFolder: clusterByFolder.value,
        enabledRelationshipTypes: enabledRelationshipTypes.value,
        enabledNodeTypes: enabledNodeTypes.value,
        hideTestFiles: hideTestFiles.value,
        memberNodeMode: memberNodeMode.value,
        highlightOrphanGlobal: highlightOrphanGlobal.value,
        showFps: showFps.value,
        showFpsAdvanced: showFpsAdvanced.value,
        renderingStrategyId: renderingStrategyId.value,
        strategyOptionsById: strategyOptionsById.value,
        edgeRendererMode: legacyEdgeRendererMode,
        enabledModuleMemberTypes: enabledModuleMemberTypes.value,
        collapsedFolderIds: Array.from(collapsedFolderIds.value),
        collapsedSections: collapsedSections.value,
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

  function setShowFps(value: boolean): void {
    showFps.value = value;
    persistSettings();
  }

  function setShowFpsAdvanced(value: boolean): void {
    showFpsAdvanced.value = value;
    persistSettings();
  }

  function initializeRenderingStrategyId(value: RenderingStrategyId): void {
    if (hasPersistedRenderingStrategyId) {
      return;
    }
    renderingStrategyId.value = value;
  }

  function setRenderingStrategyId(value: RenderingStrategyId): void {
    renderingStrategyId.value = value;
    persistSettings();
  }

  function setRenderingStrategyOption(
    strategyId: RenderingStrategyId,
    optionId: string,
    value: unknown
  ): void {
    if (!optionId) {
      return;
    }

    const existingStrategyOptions = strategyOptionsById.value[strategyId];
    if (existingStrategyOptions[optionId] === value) {
      return;
    }

    strategyOptionsById.value = {
      ...strategyOptionsById.value,
      [strategyId]: {
        ...existingStrategyOptions,
        [optionId]: value,
      },
    };
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

  function setCollapsedSection(sectionId: GraphControlSectionKey, collapsed: boolean): void {
    if (collapsedSections.value[sectionId] === collapsed) {
      return;
    }
    collapsedSections.value = {
      ...collapsedSections.value,
      [sectionId]: collapsed,
    };
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
    enabledNodeTypes,
    hideTestFiles,
    memberNodeMode,
    highlightOrphanGlobal,
    showFps,
    showFpsAdvanced,
    renderingStrategyId,
    strategyOptionsById,
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
    setShowFps,
    setShowFpsAdvanced,
    initializeRenderingStrategyId,
    setRenderingStrategyId,
    setRenderingStrategyOption,
    enabledModuleMemberTypes,
    toggleModuleMemberType,
    collapsedFolderIds,
    toggleFolderCollapsed,
    collapsedSections,
    setCollapsedSection,
    showDebugBounds,
    setShowDebugBounds,
    showDebugHandles,
    setShowDebugHandles,
    showDebugNodeIds,
    setShowDebugNodeIds,
  };
});
