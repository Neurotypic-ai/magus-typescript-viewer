import { defineStore } from "pinia";
import { ref } from "vue";

interface GraphSettingsState {
  collapseScc: boolean;
  clusterByFolder: boolean;
}

export const useGraphSettings = defineStore("graphSettings", () => {
  const collapseScc = ref<boolean>(true);
  const clusterByFolder = ref<boolean>(false);

  function setCollapseScc(value: boolean): void {
    collapseScc.value = value;
  }

  function setClusterByFolder(value: boolean): void {
    clusterByFolder.value = value;
  }

  return {
    collapseScc,
    clusterByFolder,
    setCollapseScc,
    setClusterByFolder,
  } as unknown as GraphSettingsState & {
    setCollapseScc: (value: boolean) => void;
    setClusterByFolder: (value: boolean) => void;
  };
});
