import { describe, expect, it } from 'vitest';

import { classifyWheelIntent } from '../wheelIntent';

function createWheelEvent(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ...overrides,
  } as WheelEvent;
}

describe('classifyWheelIntent', () => {
  it('classifies ctrlKey events as pinch (macOS pinch-to-zoom)', () => {
    expect(classifyWheelIntent(createWheelEvent({ ctrlKey: true, deltaY: -5 }))).toBe('pinch');
  });

  it('classifies line-based deltaMode as mouseWheel', () => {
    expect(classifyWheelIntent(createWheelEvent({ deltaMode: 1, deltaY: 3 }))).toBe('mouseWheel');
  });

  it('classifies events with horizontal delta as trackpadScroll', () => {
    expect(classifyWheelIntent(createWheelEvent({ deltaX: 12, deltaY: 5 }))).toBe('trackpadScroll');
  });

  it('classifies small Y-only delta as trackpadScroll (inertial)', () => {
    expect(classifyWheelIntent(createWheelEvent({ deltaY: 15 }))).toBe('trackpadScroll');
  });

  it('classifies large Y-only delta as mouseWheel', () => {
    expect(classifyWheelIntent(createWheelEvent({ deltaY: 120 }))).toBe('mouseWheel');
  });

  it('classifies negative large Y delta as mouseWheel (scroll up)', () => {
    expect(classifyWheelIntent(createWheelEvent({ deltaY: -100 }))).toBe('mouseWheel');
  });

  it('classifies zero delta as trackpadScroll (below threshold)', () => {
    expect(classifyWheelIntent(createWheelEvent({ deltaY: 0 }))).toBe('trackpadScroll');
  });
});
