import { defineStore, type SetupStoreDefinition } from 'pinia';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { getApiBaseUrl } from '../assemblers/api';

export interface SnapshotEntry {
  id: string;
  repoPath: string;
  commitHash: string;
  commitShort: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  commitAt: string;   // ISO string from JSON
  packageId: string;
  ordinal: number;
  createdAt: string;
}

interface SnapshotStore {
  snapshots: Ref<SnapshotEntry[]>;
  loading: Ref<boolean>;
  selectedSnapshotId: Ref<string | null>;
  selectedSnapshot: ComputedRef<SnapshotEntry | null>;
  hasSnapshots: ComputedRef<boolean>;
  isLiveMode: ComputedRef<boolean>;
  fetchSnapshots: (repoPath?: string) => Promise<void>;
  selectSnapshot: (id: string | null) => void;
  selectNext: () => void;
  selectPrev: () => void;
}

const createSnapshotStore = (): SnapshotStore => {
  const snapshots = ref<SnapshotEntry[]>([]);
  const loading = ref(false);
  const selectedSnapshotId = ref<string | null>(null);
  let requestVersion = 0;

  const selectedSnapshot = computed<SnapshotEntry | null>(() =>
    snapshots.value.find((s) => s.id === selectedSnapshotId.value) ?? null
  );

  const hasSnapshots = computed(() => snapshots.value.length > 0);

  const isLiveMode = computed(() => selectedSnapshotId.value === null);

  async function fetchSnapshots(repoPath?: string): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    try {
      const baseUrl = getApiBaseUrl();
      const url = repoPath
        ? `${baseUrl}/snapshots?repoPath=${encodeURIComponent(repoPath)}`
        : `${baseUrl}/snapshots`;
      const response = await fetch(url);
      if (version !== requestVersion) return;
      if (!response.ok) {
        snapshots.value = [];
        return;
      }
      const data = (await response.json()) as SnapshotEntry[];
      if (version !== requestVersion) return;
      snapshots.value = data;

      // Auto-select the last snapshot (highest ordinal) if any exist
      if (data.length > 0) {
        const sorted = [...data].sort((a, b) => b.ordinal - a.ordinal);
        const last = sorted[0];
        selectedSnapshotId.value = last ? last.id : null;
      } else {
        selectedSnapshotId.value = null;
      }
    } catch {
      if (version !== requestVersion) return;
      snapshots.value = [];
    } finally {
      if (version === requestVersion) {
        loading.value = false;
      }
    }
  }

  function selectSnapshot(id: string | null): void {
    selectedSnapshotId.value = id;
  }

  function selectNext(): void {
    if (snapshots.value.length === 0) return;
    if (selectedSnapshotId.value === null) {
      // In live mode — go to the highest ordinal snapshot
      const sorted = [...snapshots.value].sort((a, b) => b.ordinal - a.ordinal);
      const last = sorted[0];
      if (last) {
        selectedSnapshotId.value = last.id;
      }
      return;
    }
    const sorted = [...snapshots.value].sort((a, b) => a.ordinal - b.ordinal);
    const currentIndex = sorted.findIndex((s) => s.id === selectedSnapshotId.value);
    if (currentIndex === -1) return;
    const next = sorted[currentIndex + 1];
    if (next) {
      selectedSnapshotId.value = next.id;
    }
    // Already at the last snapshot — no change
  }

  function selectPrev(): void {
    if (snapshots.value.length === 0) return;
    if (selectedSnapshotId.value === null) return;
    const sorted = [...snapshots.value].sort((a, b) => a.ordinal - b.ordinal);
    const currentIndex = sorted.findIndex((s) => s.id === selectedSnapshotId.value);
    if (currentIndex === -1) return;
    if (currentIndex === 0) {
      // At first snapshot — no change (could go to live, but task says decrement by ordinal)
      return;
    }
    const prev = sorted[currentIndex - 1];
    if (prev) {
      selectedSnapshotId.value = prev.id;
    }
  }

  return {
    snapshots: snapshots,
    loading: loading,
    selectedSnapshotId: selectedSnapshotId,
    selectedSnapshot: selectedSnapshot,
    hasSnapshots: hasSnapshots,
    isLiveMode: isLiveMode,
    fetchSnapshots: fetchSnapshots,
    selectSnapshot: selectSnapshot,
    selectNext: selectNext,
    selectPrev: selectPrev,
  };
};

export const useSnapshotStore: SetupStoreDefinition<
  'snapshot',
  SnapshotStore
> = defineStore('snapshot', createSnapshotStore);
