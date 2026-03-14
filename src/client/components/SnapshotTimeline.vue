<script setup lang="ts">
import { useSnapshotStore } from '../stores/snapshotStore';

const snapshotStore = useSnapshotStore();
</script>

<template>
  <div v-if="snapshotStore.hasSnapshots" class="snapshot-timeline">
    <button
      v-for="snapshot in snapshotStore.snapshots"
      :key="snapshot.id"
      :class="['snapshot-btn', { active: snapshotStore.selectedSnapshotId === snapshot.id }]"
      :title="`${snapshot.commitShort}: ${snapshot.subject}\n${snapshot.authorName} · ${snapshot.commitAt}`"
      @click="snapshotStore.selectSnapshot(snapshot.id)"
    >
      {{ snapshot.commitShort }}
    </button>
    <button
      :class="['snapshot-btn', 'live-btn', { active: snapshotStore.isLiveMode }]"
      @click="snapshotStore.selectSnapshot(null)"
    >
      Live
    </button>
  </div>
</template>

<style scoped>
.snapshot-timeline {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  gap: 4px;
  padding: 8px 12px;
  background: rgba(10, 14, 39, 0.82);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 0.5rem 0.5rem 0 0;
  z-index: 50;
  max-width: calc(100vw - 2rem);
  overflow-x: auto;
}

.snapshot-btn {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 0.7rem;
  padding: 0.25rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(203, 213, 225, 0.9);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 120ms ease-out,
    border-color 120ms ease-out,
    color 120ms ease-out;
  flex-shrink: 0;
}

.snapshot-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(226, 232, 240, 1);
  border-color: rgba(148, 163, 184, 0.45);
}

.snapshot-btn:focus-visible {
  outline: 2px solid rgba(79, 156, 249, 0.7);
  outline-offset: 1px;
}

.snapshot-btn.active {
  background: rgba(79, 156, 249, 0.18);
  border-color: #4f9cf9;
  color: #4f9cf9;
}

.live-btn {
  font-style: italic;
  margin-left: 4px;
  border-color: rgba(74, 222, 128, 0.3);
  color: rgba(74, 222, 128, 0.9);
}

.live-btn:hover {
  border-color: rgba(74, 222, 128, 0.6);
  color: #4ade80;
  background: rgba(74, 222, 128, 0.08);
}

.live-btn.active {
  background: rgba(74, 222, 128, 0.14);
  border-color: #4ade80;
  color: #4ade80;
}
</style>
