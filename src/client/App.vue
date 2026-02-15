<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue';

import { createLogger } from '../shared/utils/logger';
import { GraphDataAssembler } from './assemblers/GraphDataAssembler';
import ErrorBoundary from './components/ErrorBoundary.vue';

import type { DependencyPackageGraph } from './types';

// Lazy load the DependencyGraph component for code splitting and better performance
const DependencyGraph = defineAsyncComponent(() => import('./components/DependencyGraphLazy.vue'));

// Create an app-specific logger
const appLogger = createLogger('App');
const graphDataAssembler = new GraphDataAssembler();

const graphData = ref<DependencyPackageGraph>({ packages: [] });
const isLoading = ref(true);
const error = ref<string | null>(null);

let mounted = true;
let controller: AbortController | null = null;

const fetchData = async () => {
  try {
    isLoading.value = true;
    error.value = null;

    // Create an AbortController for cleanup
    controller = new AbortController();
    const signal = controller.signal;

    appLogger.debug('Fetching graph data...');

    // Add signal to fetch operations inside assembleGraphData
    // This way we can abort the fetch if the component unmounts
    const data = await graphDataAssembler.assembleGraphData(signal);

    if (!mounted) return;

    appLogger.debug('Setting graph data...');
    graphData.value = data;
    isLoading.value = false;
  } catch (err) {
    if (!mounted) return;
    // Ignore aborted fetch errors
    if (err instanceof DOMException && err.name === 'AbortError') {
      appLogger.debug('Fetch operation was aborted');
      return;
    }
    appLogger.error('Error fetching data:', err);
    error.value = err instanceof Error ? err.message : 'An unknown error occurred';
    isLoading.value = false;
  }
};

const retryLoad = () => {
  window.location.reload();
};

onMounted(() => {
  void fetchData();
});

onUnmounted(() => {
  mounted = false;
  if (controller) {
    controller.abort();
  }
});
</script>

<template>
  <!-- Loading State -->
  <div
    v-if="isLoading"
    class="flex justify-center items-center h-screen bg-background-default text-text-primary"
    role="status"
    aria-live="polite"
  >
    <div class="flex flex-col items-center gap-4">
      <div class="w-12 h-12 border-4 border-border-default border-t-primary-main rounded-full animate-spin"></div>
      <p class="text-lg">Loading dependency graph...</p>
    </div>
  </div>

  <!-- Error State -->
  <div
    v-else-if="error"
    class="flex flex-col justify-center items-center h-screen bg-background-default p-8"
    role="alert"
    aria-live="assertive"
  >
    <h1 class="text-2xl font-bold mb-4 text-text-primary">Error Loading Graph</h1>
    <p class="mb-6 text-text-secondary">{{ error }}</p>
    <button
      @click="retryLoad"
      class="px-6 py-3 bg-white/10 text-text-primary rounded-lg hover:bg-white/20 transition-fast cursor-pointer border border-border-default font-semibold"
    >
      Retry
    </button>
  </div>

  <!-- Graph View -->
  <ErrorBoundary v-else>
    <Suspense>
      <template #default>
        <DependencyGraph :data="graphData" />
      </template>
      <template #fallback>
        <div
          class="flex justify-center items-center h-screen bg-background-default text-text-primary"
          role="status"
          aria-live="polite"
        >
          <div class="flex flex-col items-center gap-4">
            <div class="w-12 h-12 border-4 border-border-default border-t-primary-main rounded-full animate-spin"></div>
            <p class="text-lg">Loading dependency graph...</p>
          </div>
        </div>
      </template>
    </Suspense>
  </ErrorBoundary>
</template>
