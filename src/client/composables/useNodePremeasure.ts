import { nextTick, ref } from 'vue';

import { waitForNextPaint } from '../utils/dom';

import type { Ref } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';
import type { NodePremeasure, NodePremeasureResult } from './nodePremeasureTypes';

const HOST_SELECTOR = '[data-node-premeasure-root="true"]';
const ITEM_SELECTOR = '[data-node-premeasure-id]';

async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  const fontSet = document.fonts;
  if (!fontSet?.ready) {
    return;
  }

  try {
    await fontSet.ready;
  } catch {
    // Ignore font loading failures and measure with currently available fonts.
  }
}

export function createNodePremeasure(graphRootRef: Ref<HTMLElement | null>): NodePremeasure {
  const batchNodes = ref<DependencyNode[]>([]);
  const hasBatch = ref(false);

  const clearBatch = (): void => {
    batchNodes.value = [];
    hasBatch.value = false;
  };

  const measureBatch = async (nodes: DependencyNode[]): Promise<Map<string, NodePremeasureResult>> => {
    if (nodes.length === 0 || !graphRootRef.value) {
      clearBatch();
      return new Map();
    }

    batchNodes.value = nodes;
    hasBatch.value = true;

    try {
      await nextTick();
      await waitForFonts();
      await waitForNextPaint();
      await nextTick();

      const hostElement = graphRootRef.value?.querySelector<HTMLElement>(HOST_SELECTOR);
      if (!hostElement) {
        return new Map();
      }

      const measurements = new Map<string, NodePremeasureResult>();
      const nodeElements = hostElement.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
      nodeElements.forEach((nodeElement) => {
        const nodeId = nodeElement.dataset['nodePremeasureId'];
        if (!nodeId) {
          return;
        }

        const width = Math.max(1, Math.ceil(nodeElement.offsetWidth));
        const height = Math.max(1, Math.ceil(nodeElement.offsetHeight));
        const headerElement =
          nodeElement.querySelector<HTMLElement>('.base-node-header') ??
          nodeElement.querySelector<HTMLElement>('.group-node-header');

        measurements.set(nodeId, {
          width,
          height,
          headerHeight: headerElement?.offsetHeight ?? 0,
          bodyHeight: nodeElement.querySelector<HTMLElement>('.base-node-body')?.offsetHeight ?? 0,
          subnodesHeight: nodeElement.querySelector<HTMLElement>('.base-node-subnodes')?.offsetHeight ?? 0,
        });
      });

      return measurements;
    } finally {
      clearBatch();
    }
  };

  return {
    hasBatch,
    batchNodes,
    measureBatch,
    clearBatch,
  };
}
