import type { DependencyNode } from '../types/DependencyNode';

export interface NodeDimensionMeasurement {
  width: number;
  height: number;
  headerHeight: number;
  bodyHeight: number;
  subnodesHeight: number;
}

interface NodeDimensionTracker {
  start: (root: HTMLElement) => void;
  stop: () => void;
  refresh: () => void;
  get: (nodeId: string) => NodeDimensionMeasurement | undefined;
}

function measureNodeElement(nodeElement: HTMLElement): NodeDimensionMeasurement {
  return {
    width: nodeElement.offsetWidth,
    height: nodeElement.offsetHeight,
    headerHeight: nodeElement.querySelector<HTMLElement>('.base-node-header')?.offsetHeight ?? 0,
    bodyHeight: nodeElement.querySelector<HTMLElement>('.base-node-body')?.offsetHeight ?? 0,
    subnodesHeight: nodeElement.querySelector<HTMLElement>('.base-node-subnodes')?.offsetHeight ?? 0,
  };
}

export function createNodeDimensionTracker(): NodeDimensionTracker {
  const measurements = new Map<string, NodeDimensionMeasurement>();
  const observedNodeElements = new Map<string, HTMLElement>();

  let rootElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let scanRafId: number | null = null;

  const updateNodeMeasurement = (nodeId: string, nodeElement: HTMLElement): void => {
    measurements.set(nodeId, measureNodeElement(nodeElement));
  };

  const observeNodeElement = (nodeId: string, nodeElement: HTMLElement): void => {
    observedNodeElements.set(nodeId, nodeElement);
    resizeObserver?.observe(nodeElement);
    updateNodeMeasurement(nodeId, nodeElement);
  };

  const unobserveNodeElement = (nodeId: string): void => {
    const existing = observedNodeElements.get(nodeId);
    if (existing) {
      resizeObserver?.unobserve(existing);
    }
    observedNodeElements.delete(nodeId);
    measurements.delete(nodeId);
  };

  const scanNodeElements = (): void => {
    if (!rootElement) {
      return;
    }

    const liveIds = new Set<string>();
    const nodeElements = rootElement.querySelectorAll<HTMLElement>('.vue-flow__node');
    nodeElements.forEach((nodeElement) => {
      const nodeId = nodeElement.dataset['id'];
      if (!nodeId) {
        return;
      }

      liveIds.add(nodeId);
      const existing = observedNodeElements.get(nodeId);
      if (existing !== nodeElement) {
        if (existing) {
          resizeObserver?.unobserve(existing);
        }
        observeNodeElement(nodeId, nodeElement);
        return;
      }

      updateNodeMeasurement(nodeId, nodeElement);
    });

    for (const observedId of observedNodeElements.keys()) {
      if (!liveIds.has(observedId)) {
        unobserveNodeElement(observedId);
      }
    }
  };

  const scheduleScan = (): void => {
    if (scanRafId !== null) {
      return;
    }

    scanRafId = requestAnimationFrame(() => {
      scanRafId = null;
      scanNodeElements();
    });
  };

  const handleResizeEntries = (entries: ResizeObserverEntry[]): void => {
    for (const entry of entries) {
      const target = entry.target;
      if (!(target instanceof HTMLElement)) {
        continue;
      }

      const nodeElement = target.classList.contains('vue-flow__node')
        ? target
        : target.closest<HTMLElement>('.vue-flow__node');
      const nodeId = nodeElement?.dataset['id'];
      if (!nodeElement || !nodeId) {
        continue;
      }

      if (!observedNodeElements.has(nodeId)) {
        observeNodeElement(nodeId, nodeElement);
        continue;
      }

      updateNodeMeasurement(nodeId, nodeElement);
    }
  };

  return {
    start: (root: HTMLElement) => {
      rootElement = root;

      resizeObserver ??= new ResizeObserver(handleResizeEntries);
      mutationObserver ??= new MutationObserver(() => {
        scheduleScan();
      });

      mutationObserver.observe(root, { childList: true, subtree: true });
      scanNodeElements();
    },
    stop: () => {
      if (scanRafId !== null) {
        cancelAnimationFrame(scanRafId);
        scanRafId = null;
      }

      mutationObserver?.disconnect();
      mutationObserver = null;

      for (const observedElement of observedNodeElements.values()) {
        resizeObserver?.unobserve(observedElement);
      }
      resizeObserver?.disconnect();
      resizeObserver = null;

      observedNodeElements.clear();
      measurements.clear();
      rootElement = null;
    },
    refresh: () => {
      scanNodeElements();
    },
    get: (nodeId: string) => measurements.get(nodeId),
  };
}

export function isContainerNode(node: DependencyNode): boolean {
  return node.type === 'module' || node.type === 'package' || node.type === 'group' || node.data?.isContainer === true;
}
