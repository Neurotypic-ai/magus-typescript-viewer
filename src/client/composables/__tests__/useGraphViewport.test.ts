import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGraphViewport } from '../useGraphViewport';

type Viewport = { x: number; y: number; zoom: number };

class MockElement {
  private readonly matchingSelectors: Set<string>;

  constructor(matchingSelectors: string[] = []) {
    this.matchingSelectors = new Set(matchingSelectors);
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  dispatchEvent(): boolean {
    return true;
  }

  closest(selector: string): MockElement | null {
    return this.matchingSelectors.has(selector) ? this : null;
  }
}

const createWheelEvent = (overrides: Partial<WheelEvent> = {}) => {
  const preventDefault = vi.fn();
  const event = {
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    clientX: 0,
    clientY: 0,
    target: new MockElement(),
    preventDefault,
    ...overrides,
  } as unknown as WheelEvent;
  return { event, preventDefault };
};

const createViewportHarness = (options?: { platform?: string; trackpadPanSpeed?: number }) => {
  vi.stubGlobal('Element', MockElement as unknown as typeof Element);
  vi.stubGlobal('navigator', {
    platform: options?.platform ?? 'MacIntel',
    userAgent: 'Mozilla/5.0',
  });

  let currentViewport: Viewport = { x: 10, y: 20, zoom: 0.75 };
  const getViewport = vi.fn(() => ({ ...currentViewport }));
  const setViewport = vi.fn(async (vp: Viewport) => {
    currentViewport = { ...vp };
    return true;
  });
  const zoomTo = vi.fn(async (zoom: number) => {
    currentViewport = { ...currentViewport, zoom };
    return true;
  });
  const panBy = vi.fn((delta: { x: number; y: number }) => {
    currentViewport = {
      ...currentViewport,
      x: currentViewport.x + delta.x,
      y: currentViewport.y + delta.y,
    };
  });
  const onViewportChange = vi.fn();

  const viewport = useGraphViewport({
    getViewport,
    setViewport,
    zoomTo,
    panBy,
    ...(options?.trackpadPanSpeed !== undefined
      ? { trackpadPanSpeed: options.trackpadPanSpeed }
      : {}),
    onViewportChange,
  });
  viewport.syncViewportState();

  return { viewport, panBy, onViewportChange };
};

describe('useGraphViewport touchpad panning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('applies scaled trackpad delta immediately and defers viewport side effects to onMove', () => {
    const { viewport, panBy, onViewportChange } = createViewportHarness({
      platform: 'MacIntel',
      trackpadPanSpeed: 1.5,
    });
    const { event, preventDefault } = createWheelEvent({
      deltaX: 4,
      deltaY: -6,
    });

    viewport.handleWheel(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(panBy).toHaveBeenCalledTimes(1);
    expect(panBy).toHaveBeenCalledWith({ x: -6, y: 9 });
    expect(viewport.viewportState.value).toEqual({ x: 4, y: 29, zoom: 0.75 });
    expect(onViewportChange).not.toHaveBeenCalled();

    viewport.onMove();
    expect(onViewportChange).toHaveBeenCalledTimes(1);
  });

  it('passes through touchpad events over control surfaces', () => {
    const { viewport, panBy, onViewportChange } = createViewportHarness({
      platform: 'MacIntel',
      trackpadPanSpeed: 1.5,
    });
    const { event, preventDefault } = createWheelEvent({
      deltaX: 8,
      deltaY: 5,
      target: new MockElement(['[data-graph-overlay-scrollable], .vue-flow__panel']),
    });

    viewport.handleWheel(event);

    expect(panBy).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onViewportChange).not.toHaveBeenCalled();
    expect(viewport.viewportState.value).toEqual({ x: 10, y: 20, zoom: 0.75 });
  });

  it('ignores custom wheel handling on non-mac platforms', () => {
    const { viewport, panBy, onViewportChange } = createViewportHarness({
      platform: 'Win32',
      trackpadPanSpeed: 1.5,
    });
    const { event, preventDefault } = createWheelEvent({
      deltaX: 3,
      deltaY: 7,
    });

    viewport.handleWheel(event);

    expect(panBy).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onViewportChange).not.toHaveBeenCalled();
    expect(viewport.viewportState.value).toEqual({ x: 10, y: 20, zoom: 0.75 });
  });
});
