import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ref } from 'vue';

import {
  stepSpringAxis,
  isAxisSettled,
  SPRING_PROFILE_NODE,
  SPRING_PROFILE_GROUP,
  useSpringAnimation,
} from '../useSpringAnimation';

// ---------------------------------------------------------------------------
// Polyfill rAF/cAF for Node environment (needed by useSpringAnimation internals)
// ---------------------------------------------------------------------------
let rafIdCounter = 0;

beforeAll(() => {
  globalThis.requestAnimationFrame = vi.fn((_cb: FrameRequestCallback) => ++rafIdCounter);
  globalThis.cancelAnimationFrame = vi.fn();
});

afterAll(() => {
  // @ts-expect-error -- cleanup polyfill; rAF doesn't exist in Node
  delete globalThis.requestAnimationFrame;
  // @ts-expect-error -- cleanup polyfill; cAF doesn't exist in Node
  delete globalThis.cancelAnimationFrame;
});

// ---------------------------------------------------------------------------
// stepSpringAxis — pure spring physics unit tests
// ---------------------------------------------------------------------------

describe('stepSpringAxis', () => {
  it('moves toward target when displaced', () => {
    const result = stepSpringAxis(100, 0, 0, 1 / 60, SPRING_PROFILE_NODE);
    // Should move toward target (0) from current (100)
    expect(result.position).toBeLessThan(100);
    expect(result.velocity).toBeLessThan(0); // moving toward target
  });

  it('returns exact position when already at target with zero velocity', () => {
    const result = stepSpringAxis(50, 50, 0, 1 / 60, SPRING_PROFILE_NODE);
    expect(result.position).toBe(50);
    expect(result.velocity).toBe(0);
  });

  it('converges to target within reasonable frame count', () => {
    let current = 200;
    let velocity = 0;
    const target = 0;
    const dt = 1 / 60;
    let frames = 0;

    while (frames < 300) {
      const result = stepSpringAxis(current, target, velocity, dt, SPRING_PROFILE_NODE);
      current = result.position;
      velocity = result.velocity;
      frames++;

      if (Math.abs(current - target) < 0.5 && Math.abs(velocity) < 0.5) {
        break;
      }
    }

    // Should converge well within 300 frames (5 seconds at 60fps)
    expect(frames).toBeLessThan(300);
    expect(current).toBeCloseTo(target, 0);
  });

  it('produces slight overshoot with underdamped node profile', () => {
    // SPRING_PROFILE_NODE has damping=22, which is slightly underdamped
    // (critical damping ≈ 2*sqrt(170*1) ≈ 26.1)
    let current = 100;
    let velocity = 0;
    const target = 0;
    const dt = 1 / 60;
    let minPosition = current; // Track if we overshoot past target

    for (let i = 0; i < 300; i++) {
      const result = stepSpringAxis(current, target, velocity, dt, SPRING_PROFILE_NODE);
      current = result.position;
      velocity = result.velocity;
      minPosition = Math.min(minPosition, current);
    }

    // With underdamped spring, position should overshoot past 0 (go negative)
    expect(minPosition).toBeLessThan(0);
    // But overshoot should be bounded (not more than ~15% of displacement)
    expect(minPosition).toBeGreaterThan(-20);
  });

  it('group profile settles more slowly than node profile', () => {
    const dt = 1 / 60;
    let nodeFrames = 0;
    let groupFrames = 0;

    // Node profile
    let current = 100;
    let velocity = 0;
    while (nodeFrames < 600) {
      const result = stepSpringAxis(current, 0, velocity, dt, SPRING_PROFILE_NODE);
      current = result.position;
      velocity = result.velocity;
      nodeFrames++;
      if (Math.abs(current) < 0.5 && Math.abs(velocity) < 0.5) break;
    }

    // Group profile
    current = 100;
    velocity = 0;
    while (groupFrames < 600) {
      const result = stepSpringAxis(current, 0, velocity, dt, SPRING_PROFILE_GROUP);
      current = result.position;
      velocity = result.velocity;
      groupFrames++;
      if (Math.abs(current) < 0.5 && Math.abs(velocity) < 0.5) break;
    }

    // Group should take more frames to settle (heavier mass, lower stiffness)
    expect(groupFrames).toBeGreaterThan(nodeFrames);
  });

  it('caps dt to prevent instability on large time steps', () => {
    // Even with a very large dt, the spring should not explode
    const result = stepSpringAxis(100, 0, 0, 1.0, SPRING_PROFILE_NODE);
    expect(Number.isFinite(result.position)).toBe(true);
    expect(Number.isFinite(result.velocity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAxisSettled
// ---------------------------------------------------------------------------

describe('isAxisSettled', () => {
  it('returns true when displacement and velocity are below precision', () => {
    expect(isAxisSettled(0.1, 0, 0.1, 0.5)).toBe(true);
  });

  it('returns false when displacement exceeds precision', () => {
    expect(isAxisSettled(1.0, 0, 0, 0.5)).toBe(false);
  });

  it('returns false when velocity exceeds precision', () => {
    expect(isAxisSettled(0, 0, 1.0, 0.5)).toBe(false);
  });

  it('returns true at exact target with zero velocity', () => {
    expect(isAxisSettled(50, 50, 0, 0.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useSpringAnimation — composable integration tests
// ---------------------------------------------------------------------------

describe('useSpringAnimation', () => {
  it('snaps immediately when reducedMotion is true', () => {
    const receivedPositions: Map<string, { x: number; y: number }>[] = [];

    const spring = useSpringAnimation({
      onFrame: (positions) => { receivedPositions.push(new Map(positions)); },
      onSettle: vi.fn(),
      reducedMotion: ref(true),
    });

    const positions = new Map([['a', { x: 100, y: 200 }]]);
    const sizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module']]);

    spring.setTargets(positions, sizes, types);

    // Should have called onFrame immediately with exact target positions
    expect(receivedPositions.length).toBe(1);
    expect(receivedPositions[0]?.get('a')).toEqual({ x: 100, y: 200 });

    // Should NOT be animating
    expect(spring.isAnimating.value).toBe(false);

    spring.dispose();
  });

  it('does not start animation when targets match current positions', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    // First call seeds the node at target position
    const positions = new Map([['a', { x: 50, y: 50 }]]);
    const sizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module']]);

    spring.setTargets(positions, sizes, types);

    // Node was seeded at target — should not be animating
    expect(spring.isAnimating.value).toBe(false);

    spring.dispose();
  });

  it('removeNode removes node from spring system', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const positions = new Map([['a', { x: 50, y: 50 }]]);
    const sizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module']]);

    spring.setTargets(positions, sizes, types);
    expect(spring.getCurrentPositions().has('a')).toBe(true);

    spring.removeNode('a');
    expect(spring.getCurrentPositions().has('a')).toBe(false);
  });

  it('clear removes all nodes and stops animation', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const positions = new Map([
      ['a', { x: 50, y: 50 }],
      ['b', { x: 100, y: 100 }],
    ]);
    const sizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module'], ['b', 'module']]);

    spring.setTargets(positions, sizes, types);

    spring.clear();
    expect(spring.getCurrentPositions().size).toBe(0);
    expect(spring.isAnimating.value).toBe(false);
  });

  it('getCurrentSizes returns only group node sizes', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const positions = new Map([
      ['mod1', { x: 10, y: 10 }],
      ['grp1', { x: 20, y: 20 }],
    ]);
    const sizes = new Map([
      ['grp1', { width: 300, height: 200 }],
    ]);
    const types = new Map([['mod1', 'module'], ['grp1', 'group']]);

    spring.setTargets(positions, sizes, types);

    const currentSizes = spring.getCurrentSizes();
    expect(currentSizes.has('grp1')).toBe(true);
    expect(currentSizes.has('mod1')).toBe(false);

    spring.dispose();
  });

  it('preserves velocity when retargeting mid-animation', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    // Seed node at origin
    const seed = new Map([['a', { x: 0, y: 0 }]]);
    const emptySizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module']]);
    spring.setTargets(seed, emptySizes, types);

    // Set a far-away target to start animation
    const target1 = new Map([['a', { x: 200, y: 0 }]]);
    spring.setTargets(target1, emptySizes, types);

    // Node should be animating now
    expect(spring.isAnimating.value).toBe(true);

    // Retarget to a different position — this should preserve velocity
    const target2 = new Map([['a', { x: -100, y: 0 }]]);
    spring.setTargets(target2, emptySizes, types);

    // Still animating
    expect(spring.isAnimating.value).toBe(true);

    spring.dispose();
  });
});
