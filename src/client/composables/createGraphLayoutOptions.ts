import type { Ref } from 'vue';

import type {
  FitView,
  GraphLayoutInteraction,
  GraphLayoutStore,
  GraphSettings,
  NodeDimensionTracker,
  ResetSearchHighlightState,
  SyncViewportState,
  UpdateNodeInternals,
  UseGraphLayoutOptions,
} from './useGraphLayout';
import type { ManualOffset } from '../types/ManualOffset';
import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';
import type { GraphViewMode } from '../stores/graphStore';

export interface LayoutOptionsGraphStoreSource {
  nodes: DependencyNode[];
  manualOffsets: Map<string, ManualOffset>;
  setNodes: (nodes: DependencyNode[]) => void;
  setEdges: (edges: GraphEdge[]) => void;
  setOverviewSnapshot: (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] }) => void;
  setSemanticSnapshot: (snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null) => void;
  setViewMode: (mode: GraphViewMode) => void;
  suspendCacheWrites: () => void;
  resumeCacheWrites: () => void;
  applyManualOffsets: (nodes: DependencyNode[]) => DependencyNode[];
}

export interface LayoutOptionsGraphSettingsSource {
  activeRelationshipTypes: string[];
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  highlightOrphanGlobal: boolean;
}

export interface CreateGraphLayoutOptionsOptions {
  propsData: Ref<DependencyPackageGraph>;
  graphStore: LayoutOptionsGraphStoreSource;
  graphSettings: LayoutOptionsGraphSettingsSource;
  interaction: GraphLayoutInteraction;
  fitView: FitView;
  updateNodeInternals: UpdateNodeInternals;
  syncViewportState: SyncViewportState;
  nodeDimensionTracker: NodeDimensionTracker;
  resetSearchHighlightState: ResetSearchHighlightState;
  isFirefox: Ref<boolean>;
  graphRootRef: Ref<HTMLElement | null>;
}

export function createGraphLayoutOptions(options: CreateGraphLayoutOptionsOptions): UseGraphLayoutOptions {
  const {
    propsData,
    graphStore,
    graphSettings,
    interaction,
    fitView,
    updateNodeInternals,
    syncViewportState,
    nodeDimensionTracker,
    resetSearchHighlightState,
    isFirefox,
    graphRootRef,
  } = options;

  const graphLayoutStore: GraphLayoutStore = {
    get nodes() {
      return graphStore.nodes;
    },
    setNodes: (n) => {
      graphStore.setNodes(n);
    },
    setEdges: (e) => {
      graphStore.setEdges(e);
    },
    setOverviewSnapshot: (s) => {
      graphStore.setOverviewSnapshot(s);
    },
    setSemanticSnapshot: (s) => {
      graphStore.setSemanticSnapshot(s);
    },
    setViewMode: (m) => {
      graphStore.setViewMode(m);
    },
    suspendCacheWrites: () => {
      graphStore.suspendCacheWrites();
    },
    resumeCacheWrites: () => {
      graphStore.resumeCacheWrites();
    },
    get manualOffsets() {
      return graphStore.manualOffsets;
    },
    applyManualOffsets: (nodes) => graphStore.applyManualOffsets(nodes),
  };

  const graphLayoutSettings: GraphSettings = {
    get activeRelationshipTypes() {
      return graphSettings.activeRelationshipTypes;
    },
    get collapsedFolderIds() {
      return graphSettings.collapsedFolderIds;
    },
    get hideTestFiles() {
      return graphSettings.hideTestFiles;
    },
    get highlightOrphanGlobal() {
      return graphSettings.highlightOrphanGlobal;
    },
  };

  return {
    propsData,
    graphStore: graphLayoutStore,
    graphSettings: graphLayoutSettings,
    interaction,
    fitView,
    updateNodeInternals,
    syncViewportState,
    nodeDimensionTracker,
    resetSearchHighlightState,
    isFirefox,
    graphRootRef,
  };
}
