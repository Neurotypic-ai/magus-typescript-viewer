import type { Ref } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';

export interface UseMinimapHelpersOptions {
  selectedNode: Ref<DependencyNode | null>;
}

export interface MinimapHelpers {
  minimapNodeColor: (node: { type?: string }) => string;
  minimapNodeStrokeColor: (node: { id?: string }) => string;
}

export function useMinimapHelpers(options: UseMinimapHelpersOptions): MinimapHelpers {
  const { selectedNode } = options;

  const minimapNodeColor = (node: { type?: string }): string => {
    if (node.type === 'package') return 'rgba(20, 184, 166, 0.8)';
    if (node.type === 'module') return 'rgba(59, 130, 246, 0.75)';
    if (node.type === 'class' || node.type === 'interface') return 'rgba(217, 119, 6, 0.7)';
    return 'rgba(148, 163, 184, 0.6)';
  };

  const minimapNodeStrokeColor = (node: { id?: string }): string =>
    node.id === selectedNode.value?.id ? '#22d3ee' : 'rgba(226, 232, 240, 0.8)';

  return {
    minimapNodeColor,
    minimapNodeStrokeColor,
  };
}
