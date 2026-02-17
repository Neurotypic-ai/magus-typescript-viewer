import { getRenderingStrategy } from '../rendering/strategyRegistry';

import type { RenderingStrategyId } from '../rendering/RenderingStrategy';
import type { DependencyNode } from '../types/DependencyNode';

export interface SettingsHandlerGraphLayout {
  requestGraphInitialization: () => Promise<void>;
}

export interface SettingsHandlerGraphSettings {
  collapseScc: boolean;
  clusterByFolder: boolean;
  showFps: boolean;
  renderingStrategyId: RenderingStrategyId;
  setEnabledRelationshipTypes: (types: string[]) => void;
  setEnabledNodeTypes: (types: string[]) => void;
  setCollapseScc: (value: boolean) => void;
  setClusterByFolder: (value: boolean) => void;
  setHideTestFiles: (value: boolean) => void;
  setMemberNodeMode: (value: 'compact' | 'graph') => void;
  setHighlightOrphanGlobal: (value: boolean) => void;
  setShowFps: (value: boolean) => void;
  setShowFpsAdvanced: (value: boolean) => void;
  setRenderingStrategyId: (value: RenderingStrategyId) => void;
  setRenderingStrategyOption: (strategyId: RenderingStrategyId, optionId: string, value: unknown) => void;
}

export interface UseGraphSettingsHandlersOptions {
  graphLayout: SettingsHandlerGraphLayout;
  graphSettings: SettingsHandlerGraphSettings;
  setSelectedNode: (node: DependencyNode | null) => void;
  syncViewportState: () => void;
  requestViewportRecalc: (force?: boolean) => void;
}

export interface GraphSettingsHandlers {
  handleRelationshipFilterChange: (types: string[]) => Promise<void>;
  handleNodeTypeFilterChange: (types: string[]) => Promise<void>;
  handleCollapseSccToggle: (value: boolean) => Promise<void>;
  handleClusterByFolderToggle: (value: boolean) => Promise<void>;
  handleHideTestFilesToggle: (value: boolean) => Promise<void>;
  handleMemberNodeModeChange: (value: 'compact' | 'graph') => Promise<void>;
  handleOrphanGlobalToggle: (value: boolean) => Promise<void>;
  handleShowFpsToggle: (value: boolean) => void;
  handleFpsAdvancedToggle: (value: boolean) => void;
  handleRenderingStrategyChange: (id: RenderingStrategyId) => Promise<void>;
  handleRenderingStrategyOptionChange: (payload: {
    strategyId: RenderingStrategyId;
    optionId: string;
    value: unknown;
  }) => Promise<void>;
}

export function useGraphSettingsHandlers(options: UseGraphSettingsHandlersOptions): GraphSettingsHandlers {
  const { graphLayout, graphSettings, setSelectedNode, syncViewportState, requestViewportRecalc } = options;

  const handleRelationshipFilterChange = async (types: string[]) => {
    graphSettings.setEnabledRelationshipTypes(types);
    await graphLayout.requestGraphInitialization();
  };

  const handleNodeTypeFilterChange = async (types: string[]) => {
    graphSettings.setEnabledNodeTypes(types);
    setSelectedNode(null);
    await graphLayout.requestGraphInitialization();
  };

  const handleCollapseSccToggle = async (value: boolean) => {
    const strategyForScc = getRenderingStrategy(graphSettings.renderingStrategyId);
    if ((graphSettings.clusterByFolder || strategyForScc.runtime.forcesClusterByFolder) && value) {
      graphSettings.setCollapseScc(false);
      return;
    }
    graphSettings.setCollapseScc(value);
    await graphLayout.requestGraphInitialization();
  };

  const handleClusterByFolderToggle = async (value: boolean) => {
    const activeStrategy = getRenderingStrategy(graphSettings.renderingStrategyId);
    if (activeStrategy.runtime.forcesClusterByFolder && !value) {
      graphSettings.setClusterByFolder(true);
      if (graphSettings.collapseScc) {
        graphSettings.setCollapseScc(false);
      }
      await graphLayout.requestGraphInitialization();
      return;
    }
    if (value && graphSettings.collapseScc) {
      graphSettings.setCollapseScc(false);
    }
    graphSettings.setClusterByFolder(value);
    await graphLayout.requestGraphInitialization();
  };

  const handleHideTestFilesToggle = async (value: boolean) => {
    graphSettings.setHideTestFiles(value);
    await graphLayout.requestGraphInitialization();
  };

  const handleMemberNodeModeChange = async (value: 'compact' | 'graph') => {
    graphSettings.setMemberNodeMode(value);
    await graphLayout.requestGraphInitialization();
  };

  const handleOrphanGlobalToggle = async (value: boolean) => {
    graphSettings.setHighlightOrphanGlobal(value);
    await graphLayout.requestGraphInitialization();
  };

  const handleShowFpsToggle = (value: boolean): void => {
    graphSettings.setShowFps(value);
  };

  const handleFpsAdvancedToggle = (value: boolean): void => {
    graphSettings.setShowFpsAdvanced(value);
  };

  const handleRenderingStrategyChange = async (id: RenderingStrategyId): Promise<void> => {
    const strategy = getRenderingStrategy(id);
    if (strategy.runtime.forcesClusterByFolder) {
      graphSettings.setClusterByFolder(true);
      if (graphSettings.collapseScc) {
        graphSettings.setCollapseScc(false);
      }
    }
    if (graphSettings.renderingStrategyId !== id) {
      graphSettings.setRenderingStrategyId(id);
      await graphLayout.requestGraphInitialization();
    }
    syncViewportState();
    requestViewportRecalc(true);
  };

  const handleRenderingStrategyOptionChange = async (payload: {
    strategyId: RenderingStrategyId;
    optionId: string;
    value: unknown;
  }): Promise<void> => {
    const optionTargetsActiveStrategy = payload.strategyId === graphSettings.renderingStrategyId;
    graphSettings.setRenderingStrategyOption(payload.strategyId, payload.optionId, payload.value);
    if (optionTargetsActiveStrategy) {
      await graphLayout.requestGraphInitialization();
    }
    syncViewportState();
    requestViewportRecalc(true);
  };

  return {
    handleRelationshipFilterChange,
    handleNodeTypeFilterChange,
    handleCollapseSccToggle,
    handleClusterByFolderToggle,
    handleHideTestFilesToggle,
    handleMemberNodeModeChange,
    handleOrphanGlobalToggle,
    handleShowFpsToggle,
    handleFpsAdvancedToggle,
    handleRenderingStrategyChange,
    handleRenderingStrategyOptionChange,
  };
}
