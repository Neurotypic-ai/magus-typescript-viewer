import { ref } from 'vue';

import { classifyWheelIntent, isMacPlatform } from '../utils/wheelIntent';

import type { Ref } from 'vue';

export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.5 };
const MIN_GRAPH_ZOOM = 0.1;
const MAX_GRAPH_ZOOM = 2;
const MAC_PINCH_ZOOM_SENSITIVITY = 0.014;
const MAC_MOUSE_WHEEL_ZOOM_SENSITIVITY = 0.006;
const MAX_ZOOM_DELTA_PER_EVENT = 140;

export interface UseGraphViewportOptions {
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (vp: { x: number; y: number; zoom: number }, opts?: { duration: number }) => Promise<boolean>;
  zoomTo: (zoom: number, opts?: { duration: number }) => Promise<boolean>;
  panBy: (delta: { x: number; y: number }) => void;
  onViewportChange: () => void;
}

export interface GraphViewport {
  viewportState: Ref<{ x: number; y: number; zoom: number }>;
  isPanning: Ref<boolean>;
  isMac: Ref<boolean>;
  handleWheel: (event: WheelEvent) => void;
  onMoveStart: () => void;
  onMove: () => void;
  onMoveEnd: () => void;
  syncViewportState: () => void;
  scheduleViewportStateSync: () => void;
  initContainerCache: (graphRootEl: HTMLElement) => void;
  getContainerRect: () => DOMRect | null;
  dispose: () => void;
}

export function useGraphViewport(options: UseGraphViewportOptions): GraphViewport {
  const { getViewport, setViewport, zoomTo, panBy, onViewportChange } = options;

  const isMac = ref(isMacPlatform());
  const viewportState = ref({ ...DEFAULT_VIEWPORT });
  const isPanning = ref(false);

  let cachedFlowContainer: HTMLElement | null = null;
  let cachedContainerRect: DOMRect | null = null;
  let flowResizeObserver: ResizeObserver | null = null;
  let panEndTimer: ReturnType<typeof setTimeout> | null = null;
  let viewportSyncRafId: number | null = null;

  const syncViewportState = (): void => {
    viewportState.value = { ...getViewport() };
  };

  const scheduleViewportStateSync = (): void => {
    if (viewportSyncRafId !== null) {
      return;
    }

    viewportSyncRafId = requestAnimationFrame(() => {
      viewportSyncRafId = null;
      syncViewportState();
    });
  };

  const clampZoomLevel = (zoom: number): number => {
    return Math.max(MIN_GRAPH_ZOOM, Math.min(MAX_GRAPH_ZOOM, zoom));
  };

  const computeZoomFromDelta = (currentZoom: number, deltaY: number, sensitivity: number): number => {
    if (!Number.isFinite(deltaY) || deltaY === 0) {
      return currentZoom;
    }

    const boundedDelta = Math.max(-MAX_ZOOM_DELTA_PER_EVENT, Math.min(MAX_ZOOM_DELTA_PER_EVENT, deltaY));
    return clampZoomLevel(currentZoom * Math.exp(-boundedDelta * sensitivity));
  };

  const applyZoomAtPointer = (
    event: WheelEvent,
    currentViewport: { x: number; y: number; zoom: number },
    nextZoom: number
  ): void => {
    if (nextZoom === currentViewport.zoom) {
      return;
    }

    if (cachedFlowContainer && cachedContainerRect) {
      const cursorX = event.clientX - cachedContainerRect.left;
      const cursorY = event.clientY - cachedContainerRect.top;
      const scale = nextZoom / currentViewport.zoom;
      const nextViewport = {
        x: cursorX - (cursorX - currentViewport.x) * scale,
        y: cursorY - (cursorY - currentViewport.y) * scale,
        zoom: nextZoom,
      };
      viewportState.value = nextViewport;
      void setViewport(nextViewport, { duration: 0 });
    } else {
      void zoomTo(nextZoom, { duration: 0 });
      syncViewportState();
    }

    onViewportChange();
  };

  const onMoveStart = (): void => {
    if (panEndTimer) clearTimeout(panEndTimer);
    isPanning.value = true;
  };

  const onMove = (): void => {
    scheduleViewportStateSync();
    onViewportChange();
  };

  const onMoveEnd = (): void => {
    if (panEndTimer) clearTimeout(panEndTimer);
    panEndTimer = setTimeout(() => {
      isPanning.value = false;
      syncViewportState();
      onViewportChange();
    }, 120);
  };

  const handleWheel = (event: WheelEvent): void => {
    if (!isMac.value) return;

    const intent = classifyWheelIntent(event, isMac.value);
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const insideGraphNode = Boolean(target.closest('.vue-flow__node'));
    const overControlSurface = Boolean(target.closest('[data-graph-overlay-scrollable], .vue-flow__panel')) || (
      !insideGraphNode &&
      Boolean(target.closest('input, textarea, select, button, [role="slider"], [contenteditable="true"]'))
    );

    if (intent === 'pinch') {
      if (overControlSurface) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const viewport = getViewport();
      const nextZoom = computeZoomFromDelta(viewport.zoom, event.deltaY, MAC_PINCH_ZOOM_SENSITIVITY);
      applyZoomAtPointer(event, viewport, nextZoom);
      return;
    }

    if (overControlSurface) {
      return;
    }

    event.preventDefault();

    if (intent === 'trackpadScroll') {
      panBy({ x: -event.deltaX, y: -event.deltaY });
      syncViewportState();
      onViewportChange();
      return;
    }

    const viewport = getViewport();
    const nextZoom = computeZoomFromDelta(viewport.zoom, event.deltaY, MAC_MOUSE_WHEEL_ZOOM_SENSITIVITY);
    applyZoomAtPointer(event, viewport, nextZoom);
  };

  const getContainerRect = (): DOMRect | null => cachedContainerRect;

  const initContainerCache = (graphRootEl: HTMLElement): void => {
    const flowContainer = graphRootEl.querySelector<HTMLElement>('.vue-flow');
    if (flowContainer) {
      cachedFlowContainer = flowContainer;
      cachedContainerRect = flowContainer.getBoundingClientRect();
      flowResizeObserver = new ResizeObserver(() => {
        cachedContainerRect = cachedFlowContainer?.getBoundingClientRect() ?? null;
      });
      flowResizeObserver.observe(flowContainer);
    }
  };

  const dispose = (): void => {
    if (panEndTimer) {
      clearTimeout(panEndTimer);
      panEndTimer = null;
    }
    if (viewportSyncRafId !== null) {
      cancelAnimationFrame(viewportSyncRafId);
      viewportSyncRafId = null;
    }
    flowResizeObserver?.disconnect();
    flowResizeObserver = null;
    cachedFlowContainer = null;
    cachedContainerRect = null;
  };

  return {
    viewportState,
    isPanning,
    isMac,
    handleWheel,
    onMoveStart,
    onMove,
    onMoveEnd,
    syncViewportState,
    scheduleViewportStateSync,
    initContainerCache,
    getContainerRect,
    dispose,
  };
}
