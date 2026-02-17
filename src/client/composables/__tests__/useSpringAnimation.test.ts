import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import {
  SPRING_PROFILE_GROUP,
  SPRING_PROFILE_NODE,
  isAxisSettled,
  stepSpringAxis,
  useSpringAnimation,
} from '../useSpringAnimation';

interface QueuedFrame {
  id: number;
  cb: FrameRequestCallback;
}

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

let rafQueue: QueuedFrame[] = [];
let rafIdCounter = 0;
let nowMs = 0;
let nowSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  rafQueue = [];
  rafIdCounter = 0;
  nowMs = 0;
  globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    const id = ++rafIdCounter;
    rafQueue.push({ id, cb });
    return id;
  });
  globalThis.cancelAnimationFrame = vi.fn((id: number) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
  });
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  rafQueue = [];

  if (originalRequestAnimationFrame) {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  } else {
    // @ts-expect-error requestAnimationFrame is absent in Node by default
    delete globalThis.requestAnimationFrame;
  }

  if (originalCancelAnimationFrame) {
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  } else {
    // @ts-expect-error cancelAnimationFrame is absent in Node by default
    delete globalThis.cancelAnimationFrame;
  }
});

function flushNextFrame(dtMs = 16.67): void {
  nowMs += dtMs;
  const queue = [...rafQueue];
  rafQueue = [];
  for (const entry of queue) {
    entry.cb(nowMs);
  }
}

function flushFrames(count: number, dtMs = 16.67): void {
  for (let i = 0; i < count; i++) {
    if (rafQueue.length === 0) break;
    flushNextFrame(dtMs);
  }
}

function flushUntilIdle(maxFrames = 600, dtMs = 16.67): number {
  let frames = 0;
  while (rafQueue.length > 0 && frames < maxFrames) {
    flushNextFrame(dtMs);
    frames++;
  }
  return frames;
}

// ---------------------------------------------------------------------------
// stepSpringAxis — pure spring physics unit tests
// ---------------------------------------------------------------------------

describe('stepSpringAxis', () => {
  it('moves toward target when displaced', () => {
    const result = stepSpringAxis(100, 0, 0, 1 / 60, SPRING_PROFILE_NODE);
    expect(result.position).toBeLessThan(100);
    expect(result.velocity).toBeLessThan(0);
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

    expect(frames).toBeLessThan(300);
    expect(current).toBeCloseTo(target, 0);
  });

  it('produces slight overshoot with underdamped node profile', () => {
    let current = 100;
    let velocity = 0;
    const target = 0;
    const dt = 1 / 60;
    let minPosition = current;

    for (let i = 0; i < 300; i++) {
      const result = stepSpringAxis(current, target, velocity, dt, SPRING_PROFILE_NODE);
      current = result.position;
      velocity = result.velocity;
      minPosition = Math.min(minPosition, current);
    }

    expect(minPosition).toBeLessThan(0);
    expect(minPosition).toBeGreaterThan(-20);
  });

  it('group profile settles more slowly than node profile', () => {
    const dt = 1 / 60;
    let nodeFrames = 0;
    let groupFrames = 0;

    let current = 100;
    let velocity = 0;
    while (nodeFrames < 600) {
      const result = stepSpringAxis(current, 0, velocity, dt, SPRING_PROFILE_NODE);
      current = result.position;
      velocity = result.velocity;
      nodeFrames++;
      if (Math.abs(current) < 0.5 && Math.abs(velocity) < 0.5) break;
    }

    current = 100;
    velocity = 0;
    while (groupFrames < 600) {
      const result = stepSpringAxis(current, 0, velocity, dt, SPRING_PROFILE_GROUP);
      current = result.position;
      velocity = result.velocity;
      groupFrames++;
      if (Math.abs(current) < 0.5 && Math.abs(velocity) < 0.5) break;
    }

    expect(groupFrames).toBeGreaterThan(nodeFrames);
  });

  it('remains finite on large time steps', () => {
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
  it('snaps immediately when reduced motion is enabled', () => {
    const receivedPositions: Map<string, { x: number; y: number }>[] = [];
    const onSettle = vi.fn();

    const spring = useSpringAnimation({
      onFrame: (positions) => {
        receivedPositions.push(new Map(positions));
      },
      onSettle,
      reducedMotion: ref(true),
    });

    const positions = new Map([['a', { x: 100, y: 200 }]]);
    const sizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module']]);

    spring.setTargets(positions, sizes, types);

    expect(receivedPositions).toHaveLength(1);
    expect(receivedPositions[0]?.get('a')).toEqual({ x: 100, y: 200 });
    expect(spring.isAnimating.value).toBe(false);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('does not start animation when targets match current positions', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const positions = new Map([['a', { x: 50, y: 50 }]]);
    const sizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['a', 'module']]);

    spring.setTargets(positions, sizes, types);

    expect(spring.isAnimating.value).toBe(false);
    expect(rafQueue).toHaveLength(0);
  });

  it('emits frames on each tick then calls onSettle exactly once when all springs settle', () => {
    const framePositions: number[] = [];
    const onSettle = vi.fn();
    const spring = useSpringAnimation({
      onFrame: (positions) => {
        const value = positions.get('node-a');
        if (value) framePositions.push(value.x);
      },
      onSettle,
      reducedMotion: ref(false),
    });

    const emptySizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['node-a', 'module']]);
    spring.setTargets(new Map([['node-a', { x: 0, y: 0 }]]), emptySizes, types);
    spring.setTargets(new Map([['node-a', { x: 200, y: 0 }]]), emptySizes, types);

    expect(spring.isAnimating.value).toBe(true);
    const frameCount = flushUntilIdle();

    expect(frameCount).toBeGreaterThan(0);
    expect(framePositions.length).toBeGreaterThan(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(spring.isAnimating.value).toBe(false);
    expect(spring.getCurrentPositions().get('node-a')).toEqual({ x: 200, y: 0 });
  });

  it('clamps large frame deltas to prevent unstable jumps', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const emptySizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['node-a', 'module']]);
    spring.setTargets(new Map([['node-a', { x: 0, y: 0 }]]), emptySizes, types);
    spring.setTargets(new Map([['node-a', { x: 300, y: 0 }]]), emptySizes, types);

    flushNextFrame(2000);

    const currentX = spring.getCurrentPositions().get('node-a')?.x ?? Number.NaN;
    expect(Number.isFinite(currentX)).toBe(true);
    expect(currentX).toBeGreaterThan(0);
    expect(currentX).toBeLessThan(150);
    expect(spring.isAnimating.value).toBe(true);
  });

  it('animates group width and height while clamping to a minimum size of one pixel', () => {
    const observedSizes: Array<{ width: number; height: number }> = [];
    const spring = useSpringAnimation({
      onFrame: (_positions, sizes) => {
        const size = sizes.get('group-1');
        if (size) observedSizes.push(size);
      },
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const positions = new Map([['group-1', { x: 0, y: 0 }]]);
    const nodeTypes = new Map([['group-1', 'group']]);
    spring.setTargets(positions, new Map([['group-1', { width: 120, height: 80 }]]), nodeTypes);
    spring.setTargets(positions, new Map([['group-1', { width: 1, height: 1 }]]), nodeTypes);

    flushUntilIdle();

    expect(observedSizes.length).toBeGreaterThan(0);
    expect(observedSizes.every((size) => size.width >= 1 && size.height >= 1)).toBe(true);
    expect(spring.getCurrentSizes().get('group-1')).toEqual({ width: 1, height: 1 });
  });

  it('stops emitting updates for a removed node in subsequent frames', () => {
    const frames: Array<Map<string, { x: number; y: number }>> = [];
    const spring = useSpringAnimation({
      onFrame: (positions) => {
        frames.push(new Map(positions));
      },
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const emptySizes = new Map<string, { width: number; height: number }>();
    const types = new Map([
      ['a', 'module'],
      ['b', 'module'],
    ]);

    spring.setTargets(
      new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 0, y: 0 }],
      ]),
      emptySizes,
      types
    );
    spring.setTargets(
      new Map([
        ['a', { x: 300, y: 0 }],
        ['b', { x: -300, y: 0 }],
      ]),
      emptySizes,
      types
    );

    flushFrames(2);
    const frameIndexBeforeRemoval = frames.length;
    spring.removeNode('a');
    flushFrames(8);

    const framesAfterRemoval = frames.slice(frameIndexBeforeRemoval);
    expect(framesAfterRemoval.length).toBeGreaterThan(0);
    expect(framesAfterRemoval.every((frame) => !frame.has('a'))).toBe(true);
    expect(framesAfterRemoval.some((frame) => frame.has('b'))).toBe(true);
  });

  it('dispose cancels the loop and prevents further callbacks', () => {
    const onFrame = vi.fn();
    const onSettle = vi.fn();
    const spring = useSpringAnimation({
      onFrame,
      onSettle,
      reducedMotion: ref(false),
    });

    const emptySizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['node-a', 'module']]);
    spring.setTargets(new Map([['node-a', { x: 0, y: 0 }]]), emptySizes, types);
    spring.setTargets(new Map([['node-a', { x: 300, y: 0 }]]), emptySizes, types);
    flushFrames(1);

    const frameCallsBeforeDispose = onFrame.mock.calls.length;
    const settleCallsBeforeDispose = onSettle.mock.calls.length;
    spring.dispose();
    flushFrames(10);

    expect(onFrame).toHaveBeenCalledTimes(frameCallsBeforeDispose);
    expect(onSettle).toHaveBeenCalledTimes(settleCallsBeforeDispose);
    expect(spring.isAnimating.value).toBe(false);
    expect(spring.getCurrentPositions().size).toBe(0);
  });

  it('retargets mid-flight without teleporting to the new target', () => {
    const spring = useSpringAnimation({
      onFrame: vi.fn(),
      onSettle: vi.fn(),
      reducedMotion: ref(false),
    });

    const emptySizes = new Map<string, { width: number; height: number }>();
    const types = new Map([['node-a', 'module']]);
    spring.setTargets(new Map([['node-a', { x: 0, y: 0 }]]), emptySizes, types);
    spring.setTargets(new Map([['node-a', { x: 250, y: 0 }]]), emptySizes, types);

    flushFrames(3);
    const beforeRetarget = spring.getCurrentPositions().get('node-a')?.x ?? 0;

    spring.setTargets(new Map([['node-a', { x: -200, y: 0 }]]), emptySizes, types);
    flushFrames(1);

    const afterRetarget = spring.getCurrentPositions().get('node-a')?.x ?? 0;
    expect(afterRetarget).not.toBeCloseTo(-200, 3);
    expect(Math.abs(afterRetarget - beforeRetarget)).toBeLessThan(100);
    expect(spring.isAnimating.value).toBe(true);
  });
});
