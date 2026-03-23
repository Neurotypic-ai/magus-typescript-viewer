<script setup lang="ts">
import MeasureGroupNode from './MeasureGroupNode.vue';
import MeasureModuleNode from './MeasureModuleNode.vue';
import MeasurePackageNode from './MeasurePackageNode.vue';

import type { DependencyNode } from '../../../types/DependencyNode';

interface NodePremeasureHostProps {
  nodes: DependencyNode[];
}

defineProps<NodePremeasureHostProps>();
</script>

<template>
  <div v-if="nodes.length > 0" class="node-premeasure-host" data-node-premeasure-root="true" aria-hidden="true">
    <div class="node-premeasure-stack">
      <div v-for="node in nodes" :key="node.id" class="node-premeasure-item" :data-node-premeasure-id="node.id">
        <MeasurePackageNode v-if="node.type === 'package'" :node="node" />
        <MeasureModuleNode v-else-if="node.type === 'module'" :node="node" />
        <MeasureGroupNode v-else-if="node.type === 'group'" :node="node" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-premeasure-host {
  position: absolute;
  left: -10000px;
  top: 0;
  pointer-events: none;
  visibility: visible;
  overflow: hidden;
  z-index: -1;
}

.node-premeasure-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
  width: max-content;
}

.node-premeasure-item {
  width: max-content;
  max-width: none;
}
</style>
