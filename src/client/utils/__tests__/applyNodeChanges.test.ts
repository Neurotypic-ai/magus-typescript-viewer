import { describe, expect, it } from 'vitest';
import type { NodeChange } from '@vue-flow/core';

import { applyNodeChanges } from '../applyNodeChanges';

interface TestNode {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  measured?: { width: number; height: number };
  dimensions?: { width: number; height: number };
}

describe('applyNodeChanges (dimensions)', () => {
  it('writes width/height, dimensions, and measured from dimensions updates', () => {
    const nodes: TestNode[] = [{ id: 'node-1', position: { x: 0, y: 0 } }];
    const changes: NodeChange[] = [
      {
        type: 'dimensions',
        id: 'node-1',
        dimensions: { width: 320, height: 180 },
      } as NodeChange,
    ];

    const updated = applyNodeChanges(changes, nodes);
    const node = updated[0] as TestNode | undefined;
    expect(node).toBeDefined();
    expect(node?.width).toBe(320);
    expect(node?.height).toBe(180);
    expect(node?.dimensions).toEqual({ width: 320, height: 180 });
    expect(node?.measured).toEqual({ width: 320, height: 180 });
  });

  it('prefers explicit measured payload when provided', () => {
    const nodes: TestNode[] = [{ id: 'node-1', position: { x: 0, y: 0 } }];
    const changes: NodeChange[] = [
      {
        type: 'dimensions',
        id: 'node-1',
        dimensions: { width: 360, height: 200 },
        measured: { width: 350, height: 196 },
      } as NodeChange,
    ];

    const updated = applyNodeChanges(changes, nodes);
    const node = updated[0] as TestNode | undefined;
    expect(node).toBeDefined();
    expect(node?.width).toBe(360);
    expect(node?.height).toBe(200);
    expect(node?.dimensions).toEqual({ width: 360, height: 200 });
    expect(node?.measured).toEqual({ width: 350, height: 196 });
  });
});
