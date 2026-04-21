<script setup lang="ts">
import { computed, toRef } from 'vue';

import BaseNode from './BaseNode.vue';
import { buildBaseNodeProps } from './utils';

import type { DependencyProps } from '../../types/DependencyProps';

/**
 * Leaf node for external npm packages (vitest, vue, pinia, etc.) and Node.js
 * built-ins (node:fs, node:http, path, url). Rendered distinctly from MODULE
 * nodes so the graph communicates "this is an external dependency, not a
 * source file I can drill into".
 *
 * Incoming edges to this node should carry the appropriate dep classification
 * — `dependency` / `devDependency` / `peerDependency` — resolved from the
 * workspace package's package.json scope (see buildExternalPackageKindLookup
 * in createGraphEdges.ts).
 */
const props = defineProps<DependencyProps>();
const nodeData = toRef(props, 'data');

const symbolCount = computed(() => {
  const value = nodeData.value['externalPackageSymbolCount'];
  return typeof value === 'number' ? value : 0;
});

const baseNodeProps = computed(() =>
  buildBaseNodeProps(props, {
    isContainer: false,
    showSubnodes: false,
  })
);
</script>

<template>
  <BaseNode
    v-bind="baseNodeProps"
    badge-text="PACKAGE"
    badge-class="type-external-package"
    class="external-package-node"
  >
    <template #body>
      <div v-if="symbolCount > 0" class="external-package-symbol-count">
        {{ symbolCount }} symbol{{ symbolCount === 1 ? '' : 's' }} imported
      </div>
    </template>
  </BaseNode>
</template>

<style scoped>
.external-package-node {
  /* External packages are leaf nodes — render smaller than modules. */
  min-width: 180px;
}

.external-package-symbol-count {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  padding: 0.35rem 0.5rem;
}
</style>
