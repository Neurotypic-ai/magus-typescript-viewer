import type { Ref } from 'vue';

import type { FolderCollapseActions, NodeActions } from '../components/nodes/utils';
import type { LayoutProcessOptions } from './useGraphLayout';

export interface CreateGraphNodeActionsOptions {
  handleFocusNode: (nodeId: string) => void | Promise<void>;
  isolateNeighborhood: (nodeId: string) => void | Promise<void>;
  contextMenu: Ref<{ nodeId: string; nodeLabel: string; x: number; y: number } | null>;
  toggleFolderCollapsed: (folderId: string) => void;
  requestGraphInitialization: (options?: LayoutProcessOptions) => void | Promise<void>;
}

export interface GraphNodeActionsResult {
  nodeActions: NodeActions;
  folderCollapseActions: FolderCollapseActions;
}

export function createGraphNodeActions(options: CreateGraphNodeActionsOptions): GraphNodeActionsResult {
  const {
    handleFocusNode,
    isolateNeighborhood,
    contextMenu,
    toggleFolderCollapsed,
    requestGraphInitialization,
  } = options;

  const nodeActions: NodeActions = {
    focusNode: (nodeId: string) => void handleFocusNode(nodeId),
    isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
    showContextMenu: (nodeId: string, label: string, event: MouseEvent) => {
      contextMenu.value = { nodeId, nodeLabel: label, x: event.clientX, y: event.clientY };
    },
  };

  const folderCollapseActions: FolderCollapseActions = {
    toggleFolderCollapsed: (folderId: string) => {
      toggleFolderCollapsed(folderId);
      void requestGraphInitialization({
        fitViewToResult: false,
        twoPassMeasure: true,
      });
    },
  };

  return {
    nodeActions,
    folderCollapseActions,
  };
}
