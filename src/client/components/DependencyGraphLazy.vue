<script setup lang="ts">
import DependencyGraph from './DependencyGraph.vue';

import type { DependencyGraphProps } from './DependencyGraph.vue';

const props = defineProps<DependencyGraphProps>();
</script>

<template>
  <DependencyGraph :data="props.data" />
</template>
