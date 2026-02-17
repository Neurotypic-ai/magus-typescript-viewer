import type { Ref } from 'vue';

import type {
  FitView,
  GraphLayoutInteraction,
  GraphLayoutStore,
  GraphSettings,
  NodeDimensionTracker,
  ResetSearchHighlightState,
  ResumeEdgeVirtualization,
  SuspendEdgeVirtualization,
  SyncViewportState,
  UpdateNodeInternals,
  UseGraphLayoutOptions,
} from './useGraphLayout';
import type { ManualOffset } from '../types/ManualOffset';
import type { DependencyNode } from '../types/DependencyNode';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { GraphEdge } from '../types/GraphEdge';
import type { GraphViewMode } from '../stores/graphStore';
import type { RenderingStrategyId, RenderingStrategyOptionsById } from '../rendering/RenderingStrategy';

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
  enabledNodeTypes: string[];
  activeRelationshipTypes: string[];
  clusterByFolder: boolean;
  collapseScc: boolean;
  collapsedFolderIds: Set<string>;
  hideTestFiles: boolean;
  memberNodeMode: 'compact' | 'graph';
  highlightOrphanGlobal: boolean;
  renderingStrategyId: RenderingStrategyId;
  strategyOptionsById: RenderingStrategyOptionsById;
}

export interface CreateGraphLayoutOptionsOptions {
  propsData: Ref<DependencyPackageGraph>;
  graphStore: LayoutOptionsGraphStoreSource;
  graphSettings: LayoutOptionsGraphSettingsSource;
  interaction: GraphLayoutInteraction;
  fitView: FitView;
  updateNodeInternals: UpdateNodeInternals;
  suspendEdgeVirtualization: SuspendEdgeVirtualization;
  resumeEdgeVirtualization: ResumeEdgeVirtualization;
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
    suspendEdgeVirtualization,
    resumeEdgeVirtualization,
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
    get enabledNodeTypes() {
      return graphSettings.enabledNodeTypes;
    },
    get activeRelationshipTypes() {
      return graphSettings.activeRelationshipTypes;
    },
    get clusterByFolder() {
      return graphSettings.clusterByFolder;
    },
    get collapseScc() {
      return graphSettings.collapseScc;
    },
    get collapsedFolderIds() {
      return graphSettings.collapsedFolderIds;
    },
    get hideTestFiles() {
      return graphSettings.hideTestFiles;
    },
    get memberNodeMode() {
      return graphSettings.memberNodeMode;
    },
    get highlightOrphanGlobal() {
      return graphSettings.highlightOrphanGlobal;
    },
    get renderingStrategyId() {
      return graphSettings.renderingStrategyId;
    },
    get strategyOptionsById() {
      return graphSettings.strategyOptionsById;
    },
  };

  return {
    propsData,
    graphStore: graphLayoutStore,
    graphSettings: graphLayoutSettings,
    interaction,
    fitView,
    updateNodeInternals,
    suspendEdgeVirtualization,
    resumeEdgeVirtualization,
    syncViewportState,
    nodeDimensionTracker,
    resetSearchHighlightState,
    isFirefox,
    graphRootRef,
  };
}
