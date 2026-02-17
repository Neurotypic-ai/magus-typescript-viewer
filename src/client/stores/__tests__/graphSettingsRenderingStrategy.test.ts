import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GRAPH_CONTROL_SECTION_KEYS, useGraphSettings } from '../graphSettings';

const GRAPH_SETTINGS_CACHE_KEY = 'v1:typescript-viewer-graph-settings';

type LocalStorageMock = Storage & { __state: Record<string, string> };

function createLocalStorageMock(initialState: Record<string, string> = {}): LocalStorageMock {
  const state = { ...initialState };

  return {
    get length() {
      return Object.keys(state).length;
    },
    clear: vi.fn(() => {
      for (const key of Object.keys(state)) {
        Reflect.deleteProperty(state, key);
      }
    }),
    getItem: vi.fn((key: string) => state[key] ?? null),
    key: vi.fn((index: number) => Object.keys(state)[index] ?? null),
    removeItem: vi.fn((key: string) => {
      Reflect.deleteProperty(state, key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      state[key] = value;
    }),
    __state: state,
  };
}

function useStoreFixture(initialPayload?: Record<string, unknown>) {
  const initialState = initialPayload
    ? {
        [GRAPH_SETTINGS_CACHE_KEY]: JSON.stringify(initialPayload),
      }
    : {};
  const localStorageMock = createLocalStorageMock(initialState);
  vi.stubGlobal('localStorage', localStorageMock);
  setActivePinia(createPinia());

  return {
    store: useGraphSettings(),
    localStorageMock,
  };
}

function readPersistedPayload(localStorageMock: LocalStorageMock): Record<string, unknown> {
  const raw = localStorageMock.__state[GRAPH_SETTINGS_CACHE_KEY];
  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('graphSettings rendering strategy persistence', () => {
  it('persists and rehydrates renderingStrategyId', () => {
    const { store, localStorageMock } = useStoreFixture();
    store.setRenderingStrategyId('vueflow');

    const persistedPayload = readPersistedPayload(localStorageMock);
    expect(persistedPayload['renderingStrategyId']).toBe('vueflow');

    vi.stubGlobal('localStorage', localStorageMock);
    setActivePinia(createPinia());
    const rehydratedStore = useGraphSettings();

    expect(rehydratedStore.renderingStrategyId).toBe('vueflow');
  });

  it('persists and rehydrates strategyOptionsById', () => {
    const { store, localStorageMock } = useStoreFixture();
    store.setRenderingStrategyOption('canvas', 'degreeWeightedLayers', true);

    const persistedPayload = readPersistedPayload(localStorageMock);
    expect(persistedPayload['strategyOptionsById']).toMatchObject({
      canvas: {
        degreeWeightedLayers: true,
      },
    });

    vi.stubGlobal('localStorage', localStorageMock);
    setActivePinia(createPinia());
    const rehydratedStore = useGraphSettings();

    expect(rehydratedStore.strategyOptionsById.canvas['degreeWeightedLayers']).toBe(true);
  });

  it('migrates legacy degreeWeightedLayers into strategy options for canvas and vueflow', () => {
    const { store } = useStoreFixture({
      degreeWeightedLayers: true,
      strategyOptionsById: {
        canvas: {},
        vueflow: {},
        folderDistributor: { minimumDistancePx: 60 },
      },
    });

    expect(store.strategyOptionsById.canvas['degreeWeightedLayers']).toBe(true);
    expect(store.strategyOptionsById.vueflow['degreeWeightedLayers']).toBe(true);
    expect(store.strategyOptionsById.folderDistributor['minimumDistancePx']).toBe(60);
  });

  it('does not persist standalone degreeWeightedLayers', () => {
    const { store, localStorageMock } = useStoreFixture();
    store.setRenderingStrategyOption('canvas', 'degreeWeightedLayers', true);

    const persistedPayload = readPersistedPayload(localStorageMock);
    expect(persistedPayload).not.toHaveProperty('degreeWeightedLayers');
  });

  it('persists and rehydrates collapsed GraphControls sections with unknown-key tolerance', () => {
    const { store, localStorageMock } = useStoreFixture();
    store.setCollapsedSection('analysis', true);
    store.setCollapsedSection('debug', true);

    const persistedPayload = readPersistedPayload(localStorageMock);
    expect(persistedPayload['collapsedSections']).toMatchObject({
      analysis: true,
      debug: true,
    });

    localStorageMock.__state[GRAPH_SETTINGS_CACHE_KEY] = JSON.stringify({
      ...persistedPayload,
      collapsedSections: {
        ...(persistedPayload['collapsedSections'] as Record<string, boolean>),
        unknownSectionKey: true,
      },
    });

    vi.stubGlobal('localStorage', localStorageMock);
    setActivePinia(createPinia());
    const rehydratedStore = useGraphSettings();

    for (const key of GRAPH_CONTROL_SECTION_KEYS) {
      if (key === 'analysis' || key === 'debug') {
        expect(rehydratedStore.collapsedSections[key]).toBe(true);
      } else {
        expect(rehydratedStore.collapsedSections[key]).toBe(false);
      }
    }
    expect(
      Object.prototype.hasOwnProperty.call(rehydratedStore.collapsedSections, 'unknownSectionKey')
    ).toBe(false);
  });

  it('persists and rehydrates debug visibility toggles', () => {
    const { store, localStorageMock } = useStoreFixture();
    store.setShowDebugBounds(true);
    store.setShowDebugHandles(true);
    store.setShowDebugNodeIds(true);

    const persistedPayload = readPersistedPayload(localStorageMock);
    expect(persistedPayload['showDebugBounds']).toBe(true);
    expect(persistedPayload['showDebugHandles']).toBe(true);
    expect(persistedPayload['showDebugNodeIds']).toBe(true);

    vi.stubGlobal('localStorage', localStorageMock);
    setActivePinia(createPinia());
    const rehydratedStore = useGraphSettings();

    expect(rehydratedStore.showDebugBounds).toBe(true);
    expect(rehydratedStore.showDebugHandles).toBe(true);
    expect(rehydratedStore.showDebugNodeIds).toBe(true);
  });

  it.each([
    ['hybrid-canvas', 'canvas'],
    ['vue-flow', 'vueflow'],
  ] as const)('migrates legacy edgeRendererMode %s to renderingStrategyId %s', (legacyMode, expectedStrategyId) => {
    const { store } = useStoreFixture({
      edgeRendererMode: legacyMode,
    });

    expect(store.renderingStrategyId).toBe(expectedStrategyId);
  });

  it('prefers renderingStrategyId when both renderingStrategyId and edgeRendererMode exist', () => {
    const { store } = useStoreFixture({
      renderingStrategyId: 'canvas',
      edgeRendererMode: 'vue-flow',
    });

    expect(store.renderingStrategyId).toBe('canvas');
  });

  it.each([
    ['canvas', 'hybrid-canvas'],
    ['vueflow', 'vue-flow'],
    ['folderDistributor', 'vue-flow'],
  ] as const)('persists %s with backward-compatible edgeRendererMode %s', (strategyId, expectedLegacyMode) => {
    const { store, localStorageMock } = useStoreFixture();
    store.setRenderingStrategyId(strategyId);

    const persistedPayload = readPersistedPayload(localStorageMock);
    expect(persistedPayload['renderingStrategyId']).toBe(strategyId);
    expect(persistedPayload['edgeRendererMode']).toBe(expectedLegacyMode);
  });

  it('initializeRenderingStrategyId skips initialization when a persisted strategy exists', () => {
    const { store } = useStoreFixture({
      renderingStrategyId: 'vueflow',
    });

    store.initializeRenderingStrategyId('canvas');
    expect(store.renderingStrategyId).toBe('vueflow');
  });
});
