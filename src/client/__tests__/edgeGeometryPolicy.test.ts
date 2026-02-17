import { describe, expect, it } from 'vitest';

import {
  GROUP_ENTRY_STUB_PX,
  NODE_FINAL_APPROACH_PX,
  NODE_PRE_APPROACH_STUB_PX,
  buildEdgePolyline,
  buildRoundedPolylinePath,
  inferHandleSide,
  insertOrthogonalMidpoints,
  isHorizontalSide,
} from '../layout/edgeGeometryPolicy';

import type { EdgeGeometryPoint } from '../layout/edgeGeometryPolicy';

describe('edgeGeometryPolicy', () => {
  it('adds one ArrowSize perpendicular segment when entering a group target', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 50 };
    const polyline = buildEdgePolyline(source, target, {
      targetHandle: 'folder-right-in-inner',
      targetNodeType: 'group',
    });

    // Source side inferred as 'right' (dx=100 > dy=50), target side explicit 'right'.
    // Both horizontal → S-shape orthogonal routing between stubs.
    const sourceStubX = NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX;
    const targetStubX = target.x + GROUP_ENTRY_STUB_PX;
    const midX = (sourceStubX + targetStubX) / 2;

    expect(polyline).toEqual([
      source,
      { x: sourceStubX, y: 0 },
      { x: midX, y: 0 },
      { x: midX, y: target.y },
      { x: targetStubX, y: target.y },
      target,
    ]);
  });

  it('adds pre-approach and final perpendicular segments for non-group targets', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 200, y: 80 };
    const polyline = buildEdgePolyline(source, target, {
      targetHandle: 'relational-in-left',
      targetNodeType: 'module',
    });

    // Source side inferred as 'right' (dx=200 > dy=80), target side explicit 'left'.
    // Both horizontal → S-shape orthogonal routing.
    const sourceStubX = NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX;
    const targetPreX = target.x - (NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX);
    const targetFinalX = target.x - NODE_FINAL_APPROACH_PX;
    const midX = (sourceStubX + targetPreX) / 2;

    expect(polyline).toEqual([
      source,
      { x: sourceStubX, y: 0 },
      { x: midX, y: 0 },
      { x: midX, y: target.y },
      { x: targetPreX, y: target.y },
      { x: targetFinalX, y: target.y },
      target,
    ]);
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

  it('adds source-side stub for non-group source nodes', () => {
    const source = { x: 50, y: 100 };
    const target = { x: 300, y: 100 };
    const polyline = buildEdgePolyline(source, target, {
      sourceHandle: 'relational-out-right',
      sourceNodeType: 'module',
    });

    expect(polyline[0]).toEqual(source);
    expect(polyline[1]).toEqual({
      x: source.x + (NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX),
      y: source.y,
    });
    expect(polyline[polyline.length - 1]).toEqual(target);
  });

  it('builds rounded-corner path segments for orthogonal bends', () => {
    const path = buildRoundedPolylinePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      20
    );

    expect(path).not.toBeNull();
    expect(path?.start).toEqual({ x: 0, y: 0 });
    expect(path?.segments).toEqual([
      { kind: 'line', to: { x: 80, y: 0 } },
      { kind: 'quadratic', control: { x: 100, y: 0 }, to: { x: 100, y: 20 } },
      { kind: 'line', to: { x: 100, y: 100 } },
    ]);
  });

  describe('inferHandleSide', () => {
    it('returns "right" when target is to the right (dominant horizontal)', () => {
      expect(inferHandleSide({ x: 0, y: 0 }, { x: 100, y: 30 })).toBe('right');
    });

    it('returns "left" when target is to the left (dominant horizontal)', () => {
      expect(inferHandleSide({ x: 100, y: 0 }, { x: 0, y: 30 })).toBe('left');
    });

    it('returns "bottom" when target is below (dominant vertical)', () => {
      expect(inferHandleSide({ x: 0, y: 0 }, { x: 30, y: 100 })).toBe('bottom');
    });

    it('returns "top" when target is above (dominant vertical)', () => {
      expect(inferHandleSide({ x: 0, y: 100 }, { x: 30, y: 0 })).toBe('top');
    });

    it('returns "right" for purely horizontal rightward vector', () => {
      expect(inferHandleSide({ x: 0, y: 50 }, { x: 200, y: 50 })).toBe('right');
    });

    it('returns "left" for purely horizontal leftward vector', () => {
      expect(inferHandleSide({ x: 200, y: 50 }, { x: 0, y: 50 })).toBe('left');
    });

    it('returns "bottom" for purely vertical downward vector', () => {
      expect(inferHandleSide({ x: 50, y: 0 }, { x: 50, y: 200 })).toBe('bottom');
    });

    it('returns "top" for purely vertical upward vector', () => {
      expect(inferHandleSide({ x: 50, y: 200 }, { x: 50, y: 0 })).toBe('top');
    });

    it('breaks ties in favor of horizontal (exact 45-degree diagonal)', () => {
      expect(inferHandleSide({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe('right');
      expect(inferHandleSide({ x: 0, y: 0 }, { x: -100, y: -100 })).toBe('left');
      expect(inferHandleSide({ x: 0, y: 0 }, { x: 100, y: -100 })).toBe('right');
      expect(inferHandleSide({ x: 0, y: 0 }, { x: -100, y: 100 })).toBe('left');
    });

    it('returns "right" for coincident points (zero-length vector)', () => {
      expect(inferHandleSide({ x: 50, y: 50 }, { x: 50, y: 50 })).toBe('right');
    });
  });

  it('keeps straight segments when rounded path radius is zero', () => {
    const path = buildRoundedPolylinePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      0
    );

    expect(path).not.toBeNull();
    expect(path?.segments).toEqual([
      { kind: 'line', to: { x: 100, y: 0 } },
      { kind: 'line', to: { x: 100, y: 100 } },
    ]);
  });

  describe('isHorizontalSide', () => {
    it('returns true for left and right', () => {
      expect(isHorizontalSide('left')).toBe(true);
      expect(isHorizontalSide('right')).toBe(true);
    });

    it('returns false for top and bottom', () => {
      expect(isHorizontalSide('top')).toBe(false);
      expect(isHorizontalSide('bottom')).toBe(false);
    });
  });

  describe('insertOrthogonalMidpoints', () => {
    const clonePoints = (pts: EdgeGeometryPoint[]): EdgeGeometryPoint[] => pts.map((p) => ({ x: p.x, y: p.y }));

    it('inserts an L-shape midpoint when source exits horizontally and target enters vertically', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ];
      insertOrthogonalMidpoints(points, 'right', 'top');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]);
    });

    it('inserts an L-shape midpoint when source exits vertically and target enters horizontally', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ];
      insertOrthogonalMidpoints(points, 'bottom', 'left');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ]);
    });

    it('inserts S-shape midpoints when both sides exit/enter horizontally', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 60 },
      ];
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 60 },
        { x: 100, y: 60 },
      ]);
    });

    it('inserts S-shape midpoints when both sides exit/enter vertically', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 80, y: 100 },
      ];
      insertOrthogonalMidpoints(points, 'bottom', 'top');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 80, y: 50 },
        { x: 80, y: 100 },
      ]);
    });

    it('does not insert midpoints when the free segment is already horizontal', () => {
      const original: EdgeGeometryPoint[] = [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ];
      const points = clonePoints(original);
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual(original);
    });

    it('does not insert midpoints when the free segment is already vertical', () => {
      const original: EdgeGeometryPoint[] = [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ];
      const points = clonePoints(original);
      insertOrthogonalMidpoints(points, 'bottom', 'top');

      expect(points).toEqual(original);
    });

    it('skips source-side stubs when walking forward', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 36, y: 0 },
        { x: 200, y: 80 },
      ];
      insertOrthogonalMidpoints(points, 'right', 'top');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 36, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 80 },
      ]);
    });

    it('skips target-side stubs when walking backward', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 164, y: 80 },
        { x: 176, y: 80 },
        { x: 200, y: 80 },
      ];
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 82, y: 0 },
        { x: 82, y: 80 },
        { x: 164, y: 80 },
        { x: 176, y: 80 },
        { x: 200, y: 80 },
      ]);
    });

    it('handles both source and target stubs with S-shape routing', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 36, y: 0 },
        { x: 164, y: 80 },
        { x: 176, y: 80 },
        { x: 200, y: 80 },
      ];
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual([
        { x: 0, y: 0 },
        { x: 36, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 164, y: 80 },
        { x: 176, y: 80 },
        { x: 200, y: 80 },
      ]);
    });

    it('does nothing for a single-point array', () => {
      const points: EdgeGeometryPoint[] = [{ x: 10, y: 20 }];
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual([{ x: 10, y: 20 }]);
    });

    it('does nothing for an empty array', () => {
      const points: EdgeGeometryPoint[] = [];
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual([]);
    });

    it('does not insert when all points already lie on the same axis', () => {
      const original: EdgeGeometryPoint[] = [
        { x: 0, y: 50 },
        { x: 40, y: 50 },
        { x: 80, y: 50 },
        { x: 100, y: 50 },
      ];
      const points = clonePoints(original);
      insertOrthogonalMidpoints(points, 'right', 'left');

      expect(points).toEqual(original);
    });

    it('produces a polyline that buildRoundedPolylinePath can round', () => {
      const points: EdgeGeometryPoint[] = [
        { x: 0, y: 0 },
        { x: 100, y: 80 },
      ];
      insertOrthogonalMidpoints(points, 'right', 'left');

      const path = buildRoundedPolylinePath(points, 10);
      expect(path).not.toBeNull();
      if (path === null) return;

      const quadratics = path.segments.filter((s) => s.kind === 'quadratic');
      expect(quadratics.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('buildEdgePolyline integration with inferred sides', () => {
    it('produces fully orthogonal paths for edges with no explicit handles', () => {
      const source = { x: 0, y: 0 };
      const target = { x: 200, y: 100 };
      const polyline = buildEdgePolyline(source, target);

      expect(polyline[0]).toEqual(source);
      expect(polyline[polyline.length - 1]).toEqual(target);
      expect(polyline.length).toBeGreaterThan(2);

      for (let i = 0; i < polyline.length - 1; i += 1) {
        const a = polyline[i];
        const b = polyline[i + 1];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (a === undefined || b === undefined) continue;
        const isAxisAligned = Math.abs(b.x - a.x) < 0.001 || Math.abs(b.y - a.y) < 0.001;
        expect(isAxisAligned).toBe(true);
      }
    });

    it('produces rounded curves for orthogonally-routed polylines', () => {
      const source = { x: 0, y: 0 };
      const target = { x: 200, y: 100 };
      const polyline = buildEdgePolyline(source, target);
      const path = buildRoundedPolylinePath(polyline, 10);

      expect(path).not.toBeNull();
      if (path === null) return;
      expect(path.segments.some((s) => s.kind === 'quadratic')).toBe(true);
    });

    it('preserves axis-aligned paths when source and target share an axis', () => {
      const source = { x: 0, y: 50 };
      const target = { x: 200, y: 50 };
      const polyline = buildEdgePolyline(source, target);

      expect(polyline[0]).toEqual(source);
      expect(polyline[polyline.length - 1]).toEqual(target);

      for (const point of polyline) {
        expect(point.y).toBe(50);
      }
    });

    it('infers vertical sides when dy dominates dx', () => {
      const source = { x: 100, y: 0 };
      const target = { x: 120, y: 300 };
      const polyline = buildEdgePolyline(source, target);

      // Source inferred 'bottom' (dy=300 > dx=20), target inferred 'top'.
      // Source stub extends downward, target stub extends upward.
      expect(polyline[0]).toEqual(source);
      const p1 = polyline[1];
      expect(p1).toBeDefined();
      if (p1 !== undefined) {
        expect(p1.x).toBe(source.x);
        expect(p1.y).toBeGreaterThan(source.y);
      }

      const secondToLast = polyline[polyline.length - 2];
      expect(secondToLast).toBeDefined();
      if (secondToLast !== undefined) {
        expect(secondToLast.x).toBe(target.x);
        expect(secondToLast.y).toBeLessThan(target.y);
      }
    });
  });
});
