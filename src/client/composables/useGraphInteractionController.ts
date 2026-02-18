import { readonly, ref, type Ref } from 'vue';

type ScopeMode = 'overview' | 'isolate' | 'moduleDrilldown' | 'symbolDrilldown';
type CameraMode = 'free' | 'fitSelection';

export interface GraphInteractionController {
  selectionNodeId: Readonly<Ref<string | null>>;
  scopeMode: Readonly<Ref<ScopeMode>>;
  cameraMode: Readonly<Ref<CameraMode>>;
  setSelectionNodeId: (nodeId: string | null) => void;
  clearSelection: () => void;
  setScopeMode: (mode: ScopeMode) => void;
  setCameraMode: (mode: CameraMode) => void;
  resetInteraction: () => void;
}

export function useGraphInteractionController(): GraphInteractionController {
  const selectionNodeId = ref<string | null>(null);
  const scopeMode = ref<ScopeMode>('overview');
  const cameraMode = ref<CameraMode>('free');

  const setSelectionNodeId = (nodeId: string | null): void => {
    selectionNodeId.value = nodeId;
  };

  const clearSelection = (): void => {
    selectionNodeId.value = null;
    cameraMode.value = 'free';
  };

  const setScopeMode = (mode: ScopeMode): void => {
    scopeMode.value = mode;
  };

  const setCameraMode = (mode: CameraMode): void => {
    cameraMode.value = mode;
  };

  const resetInteraction = (): void => {
    selectionNodeId.value = null;
    scopeMode.value = 'overview';
    cameraMode.value = 'free';
  };

  return {
    selectionNodeId: readonly(selectionNodeId),
    scopeMode: readonly(scopeMode),
    cameraMode: readonly(cameraMode),
    setSelectionNodeId,
    clearSelection,
    setScopeMode,
    setCameraMode,
    resetInteraction,
  };
}

export type { CameraMode, ScopeMode };
