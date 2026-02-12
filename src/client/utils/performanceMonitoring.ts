import { createLogger } from '../../shared/utils/logger';

const perfLogger = createLogger('Performance');

/**
 * Creates a mark in the performance timeline
 * @param name The name of the mark
 */
export function mark(name: string): void {
  try {
    performance.mark(name);
  } catch (error) {
    perfLogger.error(`Failed to create mark ${name}:`, error);
  }
}

/**
 * Measures time between two marks and logs the results
 * @param name The name of the measurement
 * @param startMark The start mark name
 * @param endMark The end mark name
 * @returns The duration in milliseconds
 */
export function measurePerformance(name: string, startMark: string, endMark: string): number {
  try {
    // Create the measurement between marks
    performance.measure(name, startMark, endMark);

    // Get the measurement
    const entries = performance.getEntriesByName(name, 'measure');

    if (entries.length > 0 && entries[0]) {
      const duration = entries[0].duration;
      perfLogger.info(`${name} took ${duration.toFixed(2)}ms`);
      return duration;
    }
  } catch (error) {
    perfLogger.error(`Failed to measure ${name}:`, error);
  } finally {
    // Always clear marks/measures to prevent timeline growth on errors/missing entries.
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(name);
  }

  return 0;
}

/**
 * Tracks function execution time
 * @param fn The function to track
 * @param name The name of the tracking measurement
 * @returns A wrapped function that tracks performance
 */
export function trackFunction<T extends (...args: unknown[]) => unknown>(
  fn: T,
  name: string
): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>): ReturnType<T> => {
    const start = performance.now();
    try {
      // Need to type assert because TypeScript can't fully infer complex generics
      return fn(...args) as ReturnType<T>;
    } finally {
      const end = performance.now();
      perfLogger.info(`${name} took ${(end - start).toFixed(2)}ms`);
    }
  };
}

/**
 * Tracks async function execution time
 * @param fn The async function to track
 * @param name The name of the tracking measurement
 * @returns A wrapped async function that tracks performance
 */
export function trackAsyncFunction<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  name: string
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const start = performance.now();
    try {
      // Need to type assert because TypeScript can't fully infer complex generics
      return (await fn(...args)) as Awaited<ReturnType<T>>;
    } finally {
      const end = performance.now();
      perfLogger.info(`${name} took ${(end - start).toFixed(2)}ms`);
    }
  };
}

/**
 * Initialize performance monitoring for the application
 */
export function initializePerformanceMonitoring(): void {
  // Create a performance observer for various entry types
  try {
    if (typeof PerformanceObserver === 'undefined') {
      perfLogger.info('PerformanceObserver not supported in this environment');
      return;
    }

    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.entryType === 'measure') {
          perfLogger.debug(`Performance measure: ${entry.name}`, {
            duration: Math.round(entry.duration),
            startTime: Math.round(entry.startTime),
          });
        }
      });
    });

    // Observe performance measures
    observer.observe({ entryTypes: ['measure'] });
  } catch (error) {
    perfLogger.error('Failed to initialize performance observer:', error);
  }
}
