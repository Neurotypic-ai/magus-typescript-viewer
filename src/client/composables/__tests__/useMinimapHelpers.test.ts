import { ref } from 'vue';
import { describe, expect, it } from 'vitest';

import { graphTheme } from '../../theme/graphTheme';
import { useMinimapHelpers } from '../useMinimapHelpers';

import type { Ref } from 'vue';
import type { DependencyNode } from '../../types/DependencyNode';

describe('useMinimapHelpers', () => {
  it('derives node fill colors from the shared graph theme', () => {
    const selectedNode = ref(null) as Ref<DependencyNode | null>;
    const { minimapNodeColor } = useMinimapHelpers({
      selectedNode,
    });

    expect(minimapNodeColor({ type: 'package' })).toBe(graphTheme.nodes.kinds.package.minimapColor);
    expect(minimapNodeColor({ type: 'module' })).toBe(graphTheme.nodes.kinds.module.minimapColor);
    expect(minimapNodeColor({ type: 'class' })).toBe(graphTheme.nodes.kinds.class.minimapColor);
    expect(minimapNodeColor({ type: 'interface' })).toBe(graphTheme.nodes.kinds.interface.minimapColor);
    expect(minimapNodeColor({ type: 'unknown' })).toBe(graphTheme.nodes.minimap.defaultColor);
  });

  it('derives stroke colors from the shared minimap theme', () => {
    const selectedNode = ref({ id: 'node-1' } as DependencyNode | null) as Ref<DependencyNode | null>;
    const { minimapNodeStrokeColor } = useMinimapHelpers({ selectedNode });

    expect(minimapNodeStrokeColor({ id: 'node-1' })).toBe(graphTheme.nodes.minimap.selectedStrokeColor);
    expect(minimapNodeStrokeColor({ id: 'node-2' })).toBe(graphTheme.nodes.minimap.defaultStrokeColor);
  });
});
