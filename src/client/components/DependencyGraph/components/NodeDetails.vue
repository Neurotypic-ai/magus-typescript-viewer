<script setup lang="ts">
import type { DependencyNode } from '../types';

interface NodeDetailsProps {
  node: DependencyNode;
}

const props = defineProps<NodeDetailsProps>();
</script>

<template>
  <div
    class="fixed top-4 right-4 bg-background-paper p-5 rounded-lg border border-border-default shadow-2xl max-w-md max-h-[32rem] overflow-y-auto"
  >
    <h2 class="text-xl font-bold text-text-primary mb-1">{{ props.node.data?.label }}</h2>
    <p class="text-sm text-text-secondary mb-4 pb-4 border-b border-border-default">
      Type: <span class="font-semibold text-primary-main">{{ props.node.type }}</span>
    </p>

    <!-- Properties Section -->
    <div v-if="props.node.data?.properties && props.node.data?.properties.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Properties</strong>
      <div class="space-y-1">
        <div
          v-for="prop in props.node.data?.properties"
          :key="prop.name"
          class="text-sm text-text-secondary ml-3 font-mono"
        >
          <span class="text-primary-main">{{ prop.name }}</span
          ><span class="text-text-muted">:</span> {{ prop.type }}
        </div>
      </div>
    </div>

    <!-- Methods Section -->
    <div v-if="props.node.data?.methods && props.node.data?.methods.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Methods</strong>
      <div class="space-y-1">
        <div
          v-for="method in props.node.data?.methods"
          :key="method.name"
          class="text-sm text-text-secondary ml-3 font-mono"
        >
          <span class="text-primary-main">{{ method.name }}</span
          ><span class="text-text-muted">()</span><span class="text-text-muted">:</span> {{ method.returnType }}
        </div>
      </div>
    </div>

    <!-- Imports Section -->
    <div v-if="props.node.data?.imports && props.node.data?.imports.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Imports</strong>
      <div class="space-y-1">
        <div
          v-for="(imp, index) in props.node.data?.imports"
          :key="index"
          class="text-xs text-text-secondary ml-3 font-mono truncate"
        >
          {{ imp }}
        </div>
      </div>
    </div>

    <!-- Exports Section -->
    <div v-if="props.node.data?.exports && props.node.data?.exports.length > 0" class="mb-4">
      <strong class="text-sm font-semibold text-text-primary block mb-2">Exports</strong>
      <div class="space-y-1">
        <div
          v-for="(exp, index) in props.node.data?.exports"
          :key="index"
          class="text-xs text-text-secondary ml-3 font-mono truncate"
        >
          {{ exp }}
        </div>
      </div>
    </div>
  </div>
</template>
