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
  width: 1px;
  height: 1px;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  overflow: visible;
}
</style>
