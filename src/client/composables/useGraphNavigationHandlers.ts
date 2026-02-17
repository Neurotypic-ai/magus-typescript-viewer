import { buildParentMap } from '../graph/cluster/folderMembership';
import { traverseGraph } from '../graph/traversal';

import type { Ref } from 'vue';
import type { CameraMode } from './useGraphInteractionController';
import type { FitView } from './useGraphLayout';
import type { RenderingStrategyId } from '../rendering/RenderingStrategy';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

export interface NavigationHandlerViewport {
  onMoveEnd: () => void;
}

export interface NavigationHandlerEdgeVirtualization {
  requestViewportRecalc: (force?: boolean) => void;
}

export interface NavigationHandlerInteraction {
  setCameraMode: (mode: CameraMode) => void;
}

export interface NavigationHandlerGraphSnapshot {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

export interface NavigationHandlerGraphStore {
  semanticSnapshot: NavigationHandlerGraphSnapshot | null;
}

export interface NavigationHandlerGraphSettings {
  renderingStrategyId: RenderingStrategyId;
  setRenderingStrategyId: (id: RenderingStrategyId) => void;
}

export interface NavigationHandlerGraphLayout {
  requestGraphInitialization: () => Promise<void>;
}

export interface UseGraphNavigationHandlersOptions {
  nodes: Ref<DependencyNode[]>;
  setSelectedNode: (node: DependencyNode | null) => void;
  fitView: FitView;
  interaction: NavigationHandlerInteraction;
  graphStore: NavigationHandlerGraphStore;
  graphSettings: NavigationHandlerGraphSettings;
  graphLayout: NavigationHandlerGraphLayout;
  canvasRendererAvailable: Ref<boolean>;
  viewport: NavigationHandlerViewport;
  edgeVirtualization: NavigationHandlerEdgeVirtualization;
  syncViewportState: () => void;
}

export interface GraphNavigationHandlers {
  handleFocusNode: (nodeId: string) => Promise<void>;
  handleMinimapNodeClick: (params: { node: { id: string } }) => void;
  handleCanvasUnavailable: () => void;
  onMoveEnd: () => void;
}

export function useGraphNavigationHandlers(options: UseGraphNavigationHandlersOptions): GraphNavigationHandlers {
  const {
    nodes,
    setSelectedNode,
    fitView,
    interaction,
    graphStore,
    graphSettings,
    graphLayout,
    canvasRendererAvailable,
    viewport,
    edgeVirtualization,
    syncViewportState,
  } = options;

  const handleFocusNode = async (nodeId: string): Promise<void> => {
    const targetNode = nodes.value.find((node: DependencyNode) => node.id === nodeId);
    if (!targetNode) return;

    setSelectedNode(targetNode);
    interaction.setCameraMode('fitSelection');

    await fitView({ nodes: [nodeId], duration: 180, padding: 0.4 });

    const semanticSnapshot = graphStore.semanticSnapshot;
    if (semanticSnapshot) {
      void traverseGraph(nodeId, {
        maxDepth: 1,
        semanticEdges: semanticSnapshot.edges,
        semanticNodes: semanticSnapshot.nodes,
        parentMap: buildParentMap(semanticSnapshot.nodes),
      });
    }

    syncViewportState();
    edgeVirtualization.requestViewportRecalc(true);
  };

  const handleMinimapNodeClick = (params: { node: { id: string } }): void => {
    void handleFocusNode(params.node.id);
  };

  const handleCanvasUnavailable = (): void => {
    if (!canvasRendererAvailable.value) return;
    canvasRendererAvailable.value = false;
    if (graphSettings.renderingStrategyId === 'canvas') {
      graphSettings.setRenderingStrategyId('vueflow');
      void graphLayout.requestGraphInitialization();
    }
    syncViewportState();
    edgeVirtualization.requestViewportRecalc(true);
  };

  const onMoveEnd = (): void => {
    viewport.onMoveEnd();
    edgeVirtualization.requestViewportRecalc(true);
  };

  return {
    handleFocusNode,
    handleMinimapNodeClick,
    handleCanvasUnavailable,
    onMoveEnd,
  };
}
