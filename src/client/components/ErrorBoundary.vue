<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';

import { createLogger } from '../../shared/utils/logger';

const errorLogger = createLogger('ErrorBoundary');

/**
 * Error telemetry service for collecting error data
 */
class ErrorTelemetry {
  private static instance: ErrorTelemetry | null = null;
  private errors: { error: Error; componentName: string; timestamp: Date }[] = [];
  private errorCount: Record<string, number> = {};

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ErrorTelemetry {
    return (ErrorTelemetry.instance ??= new ErrorTelemetry());
  }

  /**
   * Track an error with component information
   */
  trackError(error: Error, componentName: string): void {
    this.errors.push({
      error,
      componentName,
      timestamp: new Date(),
    });

    // Track error frequency
    const errorKey = `${error.name}:${error.message}`;
    this.errorCount[errorKey] = (this.errorCount[errorKey] ?? 0) + 1;

    // Log the error with detailed information
    errorLogger.error('Vue error caught by boundary:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentName,
      count: this.errorCount[errorKey],
    });

    // In a real application, you might send this to a backend service
    // this.sendToErrorService(error, componentName);
  }

  /**
   * Get error statistics
   */
  getErrorStats(): { totalErrors: number; uniqueErrors: number; mostFrequent: string | null } {
    const uniqueErrors = Object.keys(this.errorCount).length;
    const totalErrors = Object.values(this.errorCount).reduce((sum, count) => sum + count, 0);

    let mostFrequent: string | null = null;
    let highestCount = 0;

    Object.entries(this.errorCount).forEach(([key, count]) => {
      if (count > highestCount) {
        highestCount = count;
        mostFrequent = key;
      }
    });

    return { totalErrors, uniqueErrors, mostFrequent };
  }

  /**
   * Clear tracked errors
   */
  clearErrors(): void {
    this.errors = [];
    this.errorCount = {};
  }
}

const telemetry = ErrorTelemetry.getInstance();

const hasError = ref(false);
const error = ref<Error | null>(null);

/**
 * Attempt to recover from the error by resetting state
 */
const handleRecoveryAttempt = (): void => {
  hasError.value = false;
  error.value = null;
};

/**
 * Error capture hook for Vue 3
 */
onErrorCaptured((err, instance) => {
  const errorInstance = err instanceof Error ? err : new Error(String(err));
  const componentName = instance?.$options.name ?? instance?.$options.__name ?? 'Unknown';

  // Track the error for telemetry
  telemetry.trackError(errorInstance, componentName);

  // Set the error state
  hasError.value = true;
  error.value = errorInstance;

  // Prevent the error from propagating further
  return false;
});
</script>

<template>
  <!-- Error UI -->
  <div v-if="hasError" class="error-boundary p-8 bg-red-900 text-white min-h-screen flex flex-col items-center justify-center">
    <h2 class="text-2xl font-bold mb-4">Something went wrong.</h2>
    <pre class="bg-black bg-opacity-50 p-4 rounded mb-4 max-w-2xl overflow-auto">{{ error?.message ?? 'Unknown error' }}</pre>
    <button
      @click="handleRecoveryAttempt"
      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors cursor-pointer"
    >
      Try to recover
    </button>
  </div>

  <!-- Children when there's no error -->
  <slot v-else />
</template>
