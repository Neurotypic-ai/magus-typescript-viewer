import type { DependencyNode } from '../types/DependencyNode';

export interface SettingsHandlerGraphLayout {
  requestGraphInitialization: () => Promise<void>;
}

export interface SettingsHandlerGraphSettings {
  collapseScc: boolean;
  clusterByFolder: boolean;
  showFps: boolean;
  setEnabledRelationshipTypes: (types: string[]) => void;
  setCollapseScc: (value: boolean) => void;
  setClusterByFolder: (value: boolean) => void;
  setHideTestFiles: (value: boolean) => void;
  setHighlightOrphanGlobal: (value: boolean) => void;
  setShowFps: (value: boolean) => void;
  setShowFpsAdvanced: (value: boolean) => void;
}

export interface UseGraphSettingsHandlersOptions {
  graphLayout: SettingsHandlerGraphLayout;
  graphSettings: SettingsHandlerGraphSettings;
  setSelectedNode: (node: DependencyNode | null) => void;
  syncViewportState: () => void;
}

export interface GraphSettingsHandlers {
  handleRelationshipFilterChange: (types: string[]) => Promise<void>;
  handleCollapseSccToggle: (value: boolean) => Promise<void>;
  handleClusterByFolderToggle: (value: boolean) => Promise<void>;
  handleHideTestFilesToggle: (value: boolean) => Promise<void>;
  handleOrphanGlobalToggle: (value: boolean) => Promise<void>;
  handleShowFpsToggle: (value: boolean) => void;
  handleFpsAdvancedToggle: (value: boolean) => void;
}

export function useGraphSettingsHandlers(options: UseGraphSettingsHandlersOptions): GraphSettingsHandlers {
  const { graphLayout, graphSettings } = options;

  const handleRelationshipFilterChange = async (types: string[]) => {
    graphSettings.setEnabledRelationshipTypes(types);
    await graphLayout.requestGraphInitialization();
  };

  const handleCollapseSccToggle = async (value: boolean) => {
    if (graphSettings.clusterByFolder && value) {
      graphSettings.setCollapseScc(false);
      return;
    }
    graphSettings.setCollapseScc(value);
    await graphLayout.requestGraphInitialization();
  };

  const handleClusterByFolderToggle = async (value: boolean) => {
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

  return {
    handleRelationshipFilterChange,
    handleCollapseSccToggle,
    handleClusterByFolderToggle,
    handleHideTestFilesToggle,
    handleOrphanGlobalToggle,
    handleShowFpsToggle,
    handleFpsAdvancedToggle,
  };
}
