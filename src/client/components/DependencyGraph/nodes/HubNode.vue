<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
</script>

<template>
  <div class="hub-node">
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.hub-node {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.3);
  pointer-events: none;
}
</style>
