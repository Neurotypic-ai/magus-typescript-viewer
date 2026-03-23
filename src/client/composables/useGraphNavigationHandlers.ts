import { buildParentMap } from '../graph/cluster/folderMembership';
import { traverseGraph } from '../graph/traversal';

import type { Ref } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { CameraMode } from './useGraphInteractionController';
import type { FitView } from './useGraphLayout';

interface NavigationHandlerViewport {
  onMoveEnd: () => void;
}

interface NavigationHandlerInteraction {
  setCameraMode: (mode: CameraMode) => void;
}

interface NavigationHandlerGraphSnapshot {
  nodes: DependencyNode[];
  edges: GraphEdge[];
}

interface NavigationHandlerGraphStore {
  semanticSnapshot: NavigationHandlerGraphSnapshot | null;
}

interface NavigationHandlerGraphLayout {
  requestGraphInitialization: () => Promise<void>;
}

interface UseGraphNavigationHandlersOptions {
  nodes: Ref<DependencyNode[]>;
  setSelectedNode: (node: DependencyNode | null) => void;
  fitView: FitView;
  interaction: NavigationHandlerInteraction;
  graphStore: NavigationHandlerGraphStore;
  graphLayout: NavigationHandlerGraphLayout;
  viewport: NavigationHandlerViewport;
  syncViewportState: () => void;
}

interface GraphNavigationHandlers {
  handleFocusNode: (nodeId: string) => Promise<void>;
  handleMinimapNodeClick: (params: { node: { id: string } }) => void;
  onMoveEnd: () => void;
}

export function useGraphNavigationHandlers(options: UseGraphNavigationHandlersOptions): GraphNavigationHandlers {
  const { nodes, setSelectedNode, fitView, interaction, graphStore, viewport, syncViewportState } = options;

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
  };

  const handleMinimapNodeClick = (params: { node: { id: string } }): void => {
    void handleFocusNode(params.node.id);
  };

  const onMoveEnd = (): void => {
    viewport.onMoveEnd();
  };

  return {
    handleFocusNode,
    handleMinimapNodeClick,
    onMoveEnd,
  };
}
