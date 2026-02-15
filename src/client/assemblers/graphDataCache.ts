/**
 * Singleton cache for memoizing graph data. Injected into GraphDataAssembler.
 */

import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';

export class GraphDataCache {
  private static instance: GraphDataCache | null = null;
  private cache: Map<string, { data: DependencyPackageGraph; timestamp: number }>;
  private readonly MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.cache = new Map<string, { data: DependencyPackageGraph; timestamp: number }>();
  }

  public static getInstance(): GraphDataCache {
    return (GraphDataCache.instance ??= new GraphDataCache());
  }

  public get(key: string): DependencyPackageGraph | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now - entry.timestamp > this.MAX_AGE_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  public set(key: string, data: DependencyPackageGraph): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  public clear(): void {
    this.cache.clear();
  }
}
