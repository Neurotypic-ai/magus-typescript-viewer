import type { Ref } from 'vue';
import type { CameraMode } from './useGraphInteractionController';
import type { FitView } from './useGraphLayout';
import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';

export interface SelectionHandlerState {
  selectedNode: Ref<DependencyNode | null>;
  hoveredNodeId: Ref<string | null>;
  contextMenu: Ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>;
}

export interface SelectionHandlerActions {
  setSelectedNode: (node: DependencyNode | null) => void;
  clearHoverState: () => void;
  applyHoverEdgeHighlight: (nodeId: string | null) => void;
  restoreHoverZIndex: (nodeId: string) => void;
  elevateNodeAndChildren: (nodeId: string) => void;
}

export interface SelectionHandlerGraphSettings {
  showFps: boolean;
  setShowFps: (value: boolean) => void;
}

export interface SelectionHandlerInteraction {
  setCameraMode: (mode: CameraMode) => void;
}

export interface UseGraphSelectionHandlersOptions {
  state: SelectionHandlerState;
  actions: SelectionHandlerActions;
  graphSettings: SelectionHandlerGraphSettings;
  interaction: SelectionHandlerInteraction;
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  fitView: FitView;
  syncViewportState: () => void;
  requestViewportRecalc: (force?: boolean) => void;
}

export interface GraphSelectionHandlers {
  onNodeClick: (params: { node: unknown }) => void;
  onPaneClick: () => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  onNodeMouseEnter: (params: { node: unknown }) => void;
  onNodeMouseLeave: (params: { node: unknown }) => void;
}

export function useGraphSelectionHandlers(options: UseGraphSelectionHandlersOptions): GraphSelectionHandlers {
  const { state, actions, graphSettings, interaction, nodes, edges, fitView, syncViewportState, requestViewportRecalc } =
    options;

  const onNodeClick = ({ node }: { node: unknown }): void => {
    const clickedNode = node as DependencyNode;
    actions.setSelectedNode(state.selectedNode.value?.id === clickedNode.id ? null : clickedNode);
  };

  const onPaneClick = (): void => {
    actions.setSelectedNode(null);
    state.contextMenu.value = null;
    interaction.setCameraMode('free');
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.selectedNode.value) {
      actions.setSelectedNode(null);
      return;
    }

    if (
      state.selectedNode.value &&
      (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const connectedEdges = edges.value.filter(
        (edge: GraphEdge) => edge.source === state.selectedNode.value?.id || edge.target === state.selectedNode.value?.id
      );
      if (connectedEdges.length > 0) {
        let nextNodeId: string | undefined;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          if (connectedEdges[0]) {
            nextNodeId =
              connectedEdges[0].source === state.selectedNode.value.id
                ? connectedEdges[0].target
                : connectedEdges[0].source;
          }
        } else {
          const lastEdge = connectedEdges[connectedEdges.length - 1];
          if (lastEdge) {
            nextNodeId = lastEdge.source === state.selectedNode.value.id ? lastEdge.target : lastEdge.source;
          }
        }
        if (nextNodeId) {
          const nextNode = nodes.value.find((node: DependencyNode) => node.id === nextNodeId);
          if (nextNode) {
            actions.setSelectedNode(nextNode);
            void fitView({ nodes: [nextNode.id], duration: 150, padding: 0.5 }).then(() => {
              syncViewportState();
              requestViewportRecalc(true);
            });
          }
        }
      }
    }

    if (event.key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const target = event.target;
      const tag = target instanceof HTMLElement ? target.tagName : '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        graphSettings.setShowFps(!graphSettings.showFps);
      }
    }
  };

  const onNodeMouseEnter = ({ node }: { node: unknown }): void => {
    const entered = node as DependencyNode;
    if (state.selectedNode.value !== null) {
      actions.clearHoverState();
      return;
    }
    if (entered.type === 'package' || entered.type === 'group') {
      actions.clearHoverState();
      return;
    }
    if (state.hoveredNodeId.value && state.hoveredNodeId.value !== entered.id) {
      actions.restoreHoverZIndex(state.hoveredNodeId.value);
    }
    state.hoveredNodeId.value = entered.id;
    actions.elevateNodeAndChildren(entered.id);
    actions.applyHoverEdgeHighlight(entered.id);
  };

  const onNodeMouseLeave = ({ node }: { node: unknown }): void => {
    const left = node as DependencyNode;
    if (left.type === 'package' || left.type === 'group') return;
    if (state.hoveredNodeId.value === left.id) {
      actions.clearHoverState();
    }
  };

  return {
    onNodeClick,
    onPaneClick,
    handleKeyDown,
    onNodeMouseEnter,
    onNodeMouseLeave,
  };
}
