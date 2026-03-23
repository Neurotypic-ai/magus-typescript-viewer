/**
 * Singleton cache for memoizing hydrated graph data. Injected into GraphHydrator.
 */

import type { PackageGraph } from '../../shared/types/Package';

export class GraphDataCache {
  private static instance: GraphDataCache | null = null;
  private cache: Map<string, { data: PackageGraph; timestamp: number }>;
  private readonly MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.cache = new Map<string, { data: PackageGraph; timestamp: number }>();
  }

  public static getInstance(): GraphDataCache {
    return (GraphDataCache.instance ??= new GraphDataCache());
  }

  public get(key: string): PackageGraph | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now - entry.timestamp > this.MAX_AGE_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  public set(key: string, data: PackageGraph): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  public clear(): void {
    this.cache.clear();
  }
}
