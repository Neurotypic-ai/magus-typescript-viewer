import type { Ref } from 'vue';

import { graphTheme } from '../theme/graphTheme';

import type { DependencyNode } from '../types/DependencyNode';

interface UseMinimapHelpersOptions {
  selectedNode: Ref<DependencyNode | null>;
}

interface MinimapHelpers {
  minimapNodeColor: (node: { type?: string }) => string;
  minimapNodeStrokeColor: (node: { id?: string }) => string;
}

export function useMinimapHelpers(options: UseMinimapHelpersOptions): MinimapHelpers {
  const { selectedNode } = options;

  const minimapNodeColor = (node: { type?: string }): string => {
    switch (node.type) {
      case 'package':
      case 'module':
      case 'class':
      case 'interface':
      case 'enum':
      case 'type':
      case 'function':
      case 'group':
      case 'property':
      case 'method':
        return graphTheme.nodes.kinds[node.type].minimapColor;
      default:
        return graphTheme.nodes.minimap.defaultColor;
    }
  };

  const minimapNodeStrokeColor = (node: { id?: string }): string =>
    node.id === selectedNode.value?.id
      ? graphTheme.nodes.minimap.selectedStrokeColor
      : graphTheme.nodes.minimap.defaultStrokeColor;

  return {
    minimapNodeColor,
    minimapNodeStrokeColor,
  };
}
