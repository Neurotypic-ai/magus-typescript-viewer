import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebWorkerLayoutProcessor } from '../WebWorkerLayoutProcessor';

import type { Edge } from '@vue-flow/core';
import type { DependencyNode } from '../../types/DependencyNode';

type MessageHandler = (event: MessageEvent) => void;
type ErrorHandler = (event: ErrorEvent) => void;

class HangingWorkerMock {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();

  addEventListener(type: 'message' | 'error', listener: MessageHandler | ErrorHandler): void {
    if (type === 'message') {
      this.messageHandlers.add(listener as MessageHandler);
      return;
    }
    this.errorHandlers.add(listener as ErrorHandler);
  }

  removeEventListener(type: 'message' | 'error', listener: MessageHandler | ErrorHandler): void {
    if (type === 'message') {
      this.messageHandlers.delete(listener as MessageHandler);
      return;
    }
    this.errorHandlers.delete(listener as ErrorHandler);
  }

  postMessage(): void {
    // Intentionally never responds to simulate a stuck worker.
  }

  terminate(): void {
    this.messageHandlers.clear();
    this.errorHandlers.clear();
  }
}

function createMinimalNode(id: string): DependencyNode {
  return {
    id,
    type: 'module',
    position: { x: 0, y: 0 },
    data: {},
  } as unknown as DependencyNode;
}

function createWorkerConstructor() {
  return vi.fn(function MockWorker() {
    return new HangingWorkerMock() as unknown as Worker;
  });
}

describe('WebWorkerLayoutProcessor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('falls back to simplified layout when worker request times out', async () => {
    const workerCtor = createWorkerConstructor();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('Worker', workerCtor as unknown as typeof Worker);

    const processor = new WebWorkerLayoutProcessor(undefined, { timeoutMs: 5 });
    const resultPromise = processor.processLayout({
      nodes: [createMinimalNode('a'), createMinimalNode('b')],
      edges: [] as Edge[],
    });

    await vi.advanceTimersByTimeAsync(6);
    const result = await resultPromise;

    expect(workerCtor).toHaveBeenCalledTimes(2);
    expect(result.nodes).toHaveLength(2);
    for (const node of result.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Layout timed out after 5ms'));

    processor.dispose();
  });

  it('uses longer default timeout for Firefox user agent', async () => {
    const workerCtor = createWorkerConstructor();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.stubGlobal('Worker', workerCtor as unknown as typeof Worker);

    const processor = new WebWorkerLayoutProcessor(undefined, { userAgent: 'Mozilla/5.0 Firefox/137.0' });
    const resultPromise = processor.processLayout({
      nodes: [createMinimalNode('firefox-only')],
      edges: [] as Edge[],
    });

    const timeoutDelays = timeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((value): value is number => typeof value === 'number');
    expect(timeoutDelays).toContain(60_000);

    await vi.advanceTimersByTimeAsync(60_001);
    await resultPromise;
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Layout timed out after 60000ms'));

    processor.dispose();
  });
});
