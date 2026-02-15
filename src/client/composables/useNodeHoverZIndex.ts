import type { Ref } from 'vue';

import type { DependencyNode } from '../types';

const HOVER_Z = '9999';

export interface UseNodeHoverZIndexOptions {
  graphRootRef: Ref<HTMLElement | null>;
  nodes: Ref<DependencyNode[]>;
}

export interface NodeHoverZIndex {
  elevateNodeAndChildren: (nodeId: string) => void;
  restoreHoverZIndex: (nodeId: string) => void;
}

export function useNodeHoverZIndex(options: UseNodeHoverZIndexOptions): NodeHoverZIndex {
  const { graphRootRef, nodes } = options;

  const elevateNodeAndChildren = (nodeId: string): void => {
    const root = graphRootRef.value;
    if (!root) return;

    const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
    if (el) {
      el.dataset['prevZ'] = el.style.zIndex;
      el.style.zIndex = HOVER_Z;
    }
    for (const n of nodes.value) {
      if (n.parentNode === nodeId) {
        const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
        if (child) {
          child.dataset['prevZ'] = child.style.zIndex;
          child.style.zIndex = HOVER_Z;
        }
      }
    }
  };

  const restoreHoverZIndex = (nodeId: string): void => {
    const root = graphRootRef.value;
    if (!root) return;

    const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
    if (el?.dataset['prevZ'] !== undefined) {
      el.style.zIndex = el.dataset['prevZ'];
      delete el.dataset['prevZ'];
    }
    for (const n of nodes.value) {
      if (n.parentNode === nodeId) {
        const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
        if (child?.dataset['prevZ'] !== undefined) {
          child.style.zIndex = child.dataset['prevZ'];
          delete child.dataset['prevZ'];
        }
      }
    }
  };

  return {
    elevateNodeAndChildren,
    restoreHoverZIndex,
  };
}
