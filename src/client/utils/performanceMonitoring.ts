import { consola } from 'consola';

const perfLogger = consola.withTag('Performance');
let performanceMeasureSequence = 0;

/**
 * Measures time between two marks and logs the results
 * @param name The name of the measurement
 * @param startMark The start mark name
 * @param endMark The end mark name
 * @returns The duration in milliseconds
 */
export function measurePerformance(name: string, startMark: string, endMark: string): number {
  const measurementName = `${name}#${String(++performanceMeasureSequence)}`;
  try {
    if (performance.getEntriesByName(startMark, 'mark').length === 0) {
      return 0;
    }
    if (performance.getEntriesByName(endMark, 'mark').length === 0) {
      return 0;
    }

    // Create the measurement between marks
    performance.measure(measurementName, startMark, endMark);

    // Get the measurement
    const entries = performance.getEntriesByName(measurementName, 'measure');

    const latestEntry = entries[entries.length - 1];
    if (latestEntry) {
      const duration = latestEntry.duration;
      perfLogger.info(`${name} took ${duration.toFixed(2)}ms`);
      return duration;
    }
  } catch (error) {
    perfLogger.error(`Failed to measure ${name}:`, error);
  } finally {
    // Always clear marks/measures to prevent timeline growth on errors/missing entries.
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(measurementName);
  }

  return 0;
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
