import { readonly, ref } from 'vue';

type ScopeMode = 'overview' | 'isolate' | 'moduleDrilldown' | 'symbolDrilldown';
type CameraMode = 'free' | 'fitSelection';

export function useGraphInteractionController() {
  const selectionNodeId = ref<string | null>(null);
  const scopeMode = ref<ScopeMode>('overview');
  const cameraMode = ref<CameraMode>('free');

  const setSelectionNodeId = (nodeId: string | null) => {
    selectionNodeId.value = nodeId;
  };

  const clearSelection = () => {
    selectionNodeId.value = null;
    cameraMode.value = 'free';
  };

  const setScopeMode = (mode: ScopeMode) => {
    scopeMode.value = mode;
  };

  const setCameraMode = (mode: CameraMode) => {
    cameraMode.value = mode;
  };

  const resetInteraction = () => {
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
