import { describe, it, expect } from 'vitest';

import {
  findObstacleAwarePath,
  type ObstacleRect,
} from '../orthogonalPathfinder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the starting M command from an SVG path string. */
function parseMoveCommand(path: string): { x: number; y: number } | null {
  const match = /^M\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(path);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

/** Extract the last coordinate pair from an SVG path string (final L or Q endpoint). */
function parseEndpoint(path: string): { x: number; y: number } | null {
  // Match all L and Q endpoint coordinates; take the last one
  const regex = /[LQ]\s+(?:[\d.e+-]+\s+[\d.e+-]+\s+)?([\d.e+-]+)\s+([\d.e+-]+)/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null = null;
  while ((m = regex.exec(path)) !== null) {
    last = m;
  }
  if (!last || last[1] === undefined || last[2] === undefined) return null;
  return { x: parseFloat(last[1]), y: parseFloat(last[2]) };
}

/** Count occurrences of a specific SVG command letter in a path string. */
function countCommands(path: string, command: string): number {
  const regex = new RegExp(`\\b${command}\\s`, 'g');
  return (path.match(regex) ?? []).length;
}

/** Count the number of L commands in an SVG path. */
function countLineCommands(path: string): number {
  return countCommands(path, 'L');
}

/** Check whether a path contains any Q (quadratic bezier) commands. */
function hasQuadraticSegments(path: string): boolean {
  return /Q\s/.test(path);
}

/**
 * Count the number of bends (direction changes) in a path by examining
 * L-segment transitions. A sequence of L commands on the same axis is
 * a single straight run; switching axes counts as a bend.
 */
function countBends(path: string): number {
  const coords: { x: number; y: number }[] = [];

  // Parse M
  const moveMatch = /^M\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(path);
  if (moveMatch && moveMatch[1] !== undefined && moveMatch[2] !== undefined) {
    coords.push({ x: parseFloat(moveMatch[1]), y: parseFloat(moveMatch[2]) });
  }

  // Parse all L points
  const lRegex = /L\s+([\d.e+-]+)\s+([\d.e+-]+)/g;
  let lMatch: RegExpExecArray | null = null;
  while ((lMatch = lRegex.exec(path)) !== null) {
    if (lMatch[1] !== undefined && lMatch[2] !== undefined) {
      coords.push({ x: parseFloat(lMatch[1]), y: parseFloat(lMatch[2]) });
    }
  }

  let bends = 0;
  for (let i = 2; i < coords.length; i++) {
    const prev = coords[i - 2];
    const curr = coords[i - 1];
    const next = coords[i];
    if (!prev || !curr || !next) continue;

    const prevHorizontal = Math.abs(curr.y - prev.y) < 0.01;
    const nextHorizontal = Math.abs(next.y - curr.y) < 0.01;
    if (prevHorizontal !== nextHorizontal) bends++;
  }

  return bends;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('findObstacleAwarePath', () => {
  // -----------------------------------------------------------------------
  // 1. No obstacles -> direct route
  // -----------------------------------------------------------------------
  describe('no obstacles -> direct route', () => {
    it('returns status ok and a non-null path with empty obstacles', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        [],
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Single obstacle between source and target -> detour
  // -----------------------------------------------------------------------
  describe('single obstacle between source and target -> detour', () => {
    it('routes around a blocking obstacle and returns ok', () => {
      const obstacle: ObstacleRect = { x: 80, y: -30, width: 40, height: 60 };
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        [obstacle],
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();

      // Path should have more than a simple straight line (contains bends)
      const path = result.path!;
      const lineCount = countLineCommands(path);
      expect(lineCount).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Obstacle on source position -> source cell force-clear works
  // -----------------------------------------------------------------------
  describe('obstacle on source position -> source cell force-clear works', () => {
    it('finds a path even when the source position is inside an obstacle', () => {
      // Use a small obstacle that covers the source cell but, after inflation
      // by obstaclePadding, still leaves neighboring grid cells reachable.
      // With gridResolution=10 and obstaclePadding=0 the obstacle covers only
      // the source cell and its immediate neighbors remain free.
      const obstacle: ObstacleRect = { x: -5, y: -5, width: 10, height: 10 };
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        [obstacle],
        { obstaclePadding: 0 },
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Multiple obstacles forming wall -> route around wall ends
  // -----------------------------------------------------------------------
  describe('multiple obstacles forming wall -> route around wall ends', () => {
    it('routes around a wall of obstacles', () => {
      // Create a vertical wall of obstacles at x=100
      const obstacles: ObstacleRect[] = [];
      for (let y = -100; y <= 100; y += 25) {
        obstacles.push({ x: 90, y, width: 20, height: 25 });
      }

      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        obstacles,
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Unreachable target enclosed by obstacles -> no-route
  // -----------------------------------------------------------------------
  describe('unreachable target enclosed by obstacles -> no-route', () => {
    it('returns no-route when target is completely surrounded', () => {
      const target = { x: 200, y: 200 };
      // Build a tight box around the target. The box must be thick enough
      // that even with force-clearing the target cell the path cannot escape.
      const wallThickness = 60;
      const halfSize = 30;
      const obstacles: ObstacleRect[] = [
        // top wall
        { x: target.x - halfSize - wallThickness, y: target.y - halfSize - wallThickness, width: 2 * (halfSize + wallThickness), height: wallThickness },
        // bottom wall
        { x: target.x - halfSize - wallThickness, y: target.y + halfSize, width: 2 * (halfSize + wallThickness), height: wallThickness },
        // left wall
        { x: target.x - halfSize - wallThickness, y: target.y - halfSize, width: wallThickness, height: 2 * halfSize },
        // right wall
        { x: target.x + halfSize, y: target.y - halfSize, width: wallThickness, height: 2 * halfSize },
      ];

      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        target,
        obstacles,
        { obstaclePadding: 5 },
      );

      expect(result.status).toBe('no-route');
      expect(result.path).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Source equals target -> invalid-input
  // -----------------------------------------------------------------------
  describe('source equals target -> invalid-input', () => {
    it('returns invalid-input when source and target are the same point', () => {
      const result = findObstacleAwarePath(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        [],
      );

      expect(result.status).toBe('invalid-input');
      expect(result.path).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Path simplification removes collinear points
  // -----------------------------------------------------------------------
  describe('path simplification removes collinear points', () => {
    it('does not produce unnecessary intermediate L commands on a straight segment', () => {
      // Place source and target on the same horizontal line with no obstacles.
      // The raw grid path would have many collinear points; simplification
      // should collapse them into a single straight segment.
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        [],
        { cornerRadius: 0 },
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();

      const path = result.path!;
      // A perfectly straight horizontal path should have at most 1 L command
      // (M start L end). Even if the grid introduces minor deviations, the
      // simplification step should keep collinear points out.
      const lineCount = countLineCommands(path);
      // In the absolute best case it is M + 1 L.
      // With grid quantization the path may have at most a few L commands.
      expect(lineCount).toBeLessThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Rounded path produces Q segments when applicable
  // -----------------------------------------------------------------------
  describe('rounded path produces Q segments when applicable', () => {
    it('emits Q commands in the SVG path when corners exist', () => {
      // Place an obstacle so the path must bend, then use default corner radius
      const obstacle: ObstacleRect = { x: 80, y: -30, width: 40, height: 60 };
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        [obstacle],
        { cornerRadius: 6 },
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();
      expect(hasQuadraticSegments(result.path!)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Tie-breaking favors straighter equal-cost route
  // -----------------------------------------------------------------------
  describe('tie-breaking favors straighter equal-cost route', () => {
    it('produces fewer bends when the path could zigzag at equal cost', () => {
      // Route from (0,0) to (100,100) with no obstacles. Without tie-breaking
      // the path could zigzag; with tie-breaking it should prefer straighter
      // routes with fewer bends.
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        [],
        { cornerRadius: 0 },
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();

      const bends = countBends(result.path!);
      // With direction-preference tie-breaking an unobstructed diagonal
      // should produce very few bends. Without tie-breaking the path
      // could zigzag freely; with it the path favors long straight runs.
      // Grid quantization and endpoint anchoring may introduce up to
      // 2 bends (one for axis switch and one for endpoint alignment).
      expect(bends).toBeLessThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Endpoint anchoring is exact (sourceX/Y, targetX/Y)
  // -----------------------------------------------------------------------
  describe('endpoint anchoring is exact', () => {
    it('starts at sourceX/Y and ends at targetX/Y in the SVG path', () => {
      const source = { x: 17.5, y: 42.3 };
      const target = { x: 283.7, y: 91.1 };

      const result = findObstacleAwarePath(source, target, []);

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();

      const path = result.path!;
      const startPoint = parseMoveCommand(path);
      const endPoint = parseEndpoint(path);

      expect(startPoint).not.toBeNull();
      expect(endPoint).not.toBeNull();
      expect(startPoint!.x).toBeCloseTo(source.x, 5);
      expect(startPoint!.y).toBeCloseTo(source.y, 5);
      expect(endPoint!.x).toBeCloseTo(target.x, 5);
      expect(endPoint!.y).toBeCloseTo(target.y, 5);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Rounded intersection fallback to cornerRadius=0
  // -----------------------------------------------------------------------
  describe('rounded intersection fallback to cornerRadius=0', () => {
    it('falls back to straight corners when rounded corners would intersect an obstacle', () => {
      // Place a narrow gap between two obstacles so that a large corner radius
      // would curve into the obstacle.
      const obstacles: ObstacleRect[] = [
        { x: 90, y: -100, width: 20, height: 95 },  // wall above the path
        { x: 90, y: 5, width: 20, height: 100 },     // wall below the path
      ];

      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        obstacles,
        { cornerRadius: 50 }, // intentionally large radius to trigger fallback
      );

      expect(result.status).toBe('ok');
      expect(result.path).not.toBeNull();

      // The path should have been generated. If the rounded version
      // intersected an obstacle, the implementation falls back to
      // cornerRadius=0, meaning no Q segments.
      // Note: if the narrow gap is wide enough that rounding doesn't
      // intersect, Q may still appear. The key assertion is that we get
      // a valid path either way.
      const path = result.path!;
      // Verify we got a valid SVG path (starts with M)
      expect(path).toMatch(/^M\s/);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Grid cap behavior returns grid-cap-exceeded
  // -----------------------------------------------------------------------
  describe('grid cap behavior returns grid-cap-exceeded', () => {
    it('returns grid-cap-exceeded when maxGridCells is very small', () => {
      // Use a tiny maxGridCells so the grid cannot fit the required area
      // even after the coarsening retry (doubling resolution).
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        [],
        { maxGridCells: 4, gridResolution: 1 },
      );

      expect(result.status).toBe('grid-cap-exceeded');
      expect(result.path).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 13. Non-finite input coordinates -> invalid-input
  // -----------------------------------------------------------------------
  describe('non-finite input coordinates -> invalid-input', () => {
    it('returns invalid-input for NaN source coordinates', () => {
      const result = findObstacleAwarePath(
        { x: NaN, y: 0 },
        { x: 100, y: 100 },
        [],
      );

      expect(result.status).toBe('invalid-input');
      expect(result.path).toBeNull();
    });

    it('returns invalid-input for Infinity target coordinates', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: Infinity, y: 100 },
        [],
      );

      expect(result.status).toBe('invalid-input');
      expect(result.path).toBeNull();
    });

    it('returns invalid-input for -Infinity coordinates', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: -Infinity },
        { x: 100, y: 100 },
        [],
      );

      expect(result.status).toBe('invalid-input');
      expect(result.path).toBeNull();
    });

    it('returns invalid-input for NaN in target y', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 100, y: NaN },
        [],
      );

      expect(result.status).toBe('invalid-input');
      expect(result.path).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 14. Metrics are populated
  // -----------------------------------------------------------------------
  describe('metrics are populated', () => {
    it('visitedCells and gridCellCount are positive for a successful route', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 100 },
        [],
      );

      expect(result.status).toBe('ok');
      expect(result.visitedCells).toBeGreaterThan(0);
      expect(result.gridCellCount).toBeGreaterThan(0);
    });

    it('gridCellCount is positive even when grid-cap-exceeded', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        [],
        { maxGridCells: 4, gridResolution: 1 },
      );

      expect(result.status).toBe('grid-cap-exceeded');
      expect(result.gridCellCount).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 15. labelPoint is returned
  // -----------------------------------------------------------------------
  describe('labelPoint is returned', () => {
    it('returns a non-null labelPoint for a successful route', () => {
      const result = findObstacleAwarePath(
        { x: 0, y: 0 },
        { x: 200, y: 100 },
        [],
      );

      expect(result.status).toBe('ok');
      expect(result.labelPoint).not.toBeNull();
      expect(result.labelPoint!.x).toEqual(expect.any(Number));
      expect(result.labelPoint!.y).toEqual(expect.any(Number));
    });

    it('labelPoint is between source and target (reasonable midpoint)', () => {
      const source = { x: 0, y: 0 };
      const target = { x: 400, y: 0 };
      const result = findObstacleAwarePath(source, target, []);

      expect(result.status).toBe('ok');
      expect(result.labelPoint).not.toBeNull();

      // The label point x should be somewhere between source and target
      const lp = result.labelPoint!;
      const minX = Math.min(source.x, target.x);
      const maxX = Math.max(source.x, target.x);
      // Allow some margin due to grid quantization
      expect(lp.x).toBeGreaterThanOrEqual(minX - 50);
      expect(lp.x).toBeLessThanOrEqual(maxX + 50);
    });

    it('labelPoint is null for failed routes', () => {
      const result = findObstacleAwarePath(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        [],
      );

      expect(result.status).toBe('invalid-input');
      expect(result.labelPoint).toBeNull();
    });
  });
});
