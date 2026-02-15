import { describe, expect, it } from 'vitest';

import {
  GROUP_ENTRY_STUB_PX,
  NODE_FINAL_APPROACH_PX,
  NODE_PRE_APPROACH_STUB_PX,
  buildEdgePolyline,
} from '../layout/edgeGeometryPolicy';

describe('edgeGeometryPolicy', () => {
  it('adds one ArrowSize perpendicular segment when entering a group target', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 50 };
    const polyline = buildEdgePolyline(source, target, {
      targetHandle: 'folder-right-in-inner',
      targetNodeType: 'group',
    });

    expect(polyline).toHaveLength(3);
    expect(polyline[1]).toEqual({ x: target.x + GROUP_ENTRY_STUB_PX, y: target.y });
    expect(polyline[2]).toEqual(target);
  });

  it('adds pre-approach and final perpendicular segments for non-group targets', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 200, y: 80 };
    const polyline = buildEdgePolyline(source, target, {
      targetHandle: 'relational-in-left',
      targetNodeType: 'module',
    });

    expect(polyline).toHaveLength(4);
    expect(polyline[1]).toEqual({
      x: target.x - (NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX),
      y: target.y,
    });
    expect(polyline[2]).toEqual({ x: target.x - NODE_FINAL_APPROACH_PX, y: target.y });
    expect(polyline[3]).toEqual(target);
  });

  it('adds source-side group exit stub', () => {
    const source = { x: 40, y: 120 };
    const target = { x: 300, y: 120 };
    const polyline = buildEdgePolyline(source, target, {
      sourceHandle: 'folder-left-out',
      sourceNodeType: 'group',
      targetHandle: 'relational-in-right',
      targetNodeType: 'module',
    });

    expect(polyline[1]).toEqual({ x: source.x - GROUP_ENTRY_STUB_PX, y: source.y });
  });
});
