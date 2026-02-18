import { addSetDiff } from '../sets';

describe('addSetDiff', () => {
  it('adds items removed from previous to next (in previous but not in next)', () => {
    const target = new Set<string>();
    const previous = new Set(['a', 'b', 'c']);
    const next = new Set(['b', 'c']);

    addSetDiff(target, previous, next);

    expect(target.has('a')).toBe(true);
    expect(target.size).toBe(1);
  });

  it('adds items added from previous to next (in next but not in previous)', () => {
    const target = new Set<string>();
    const previous = new Set(['a', 'b']);
    const next = new Set(['a', 'b', 'c']);

    addSetDiff(target, previous, next);

    expect(target.has('c')).toBe(true);
    expect(target.size).toBe(1);
  });

  it('adds items from both directions (symmetric difference)', () => {
    const target = new Set<string>();
    const previous = new Set(['a', 'b']);
    const next = new Set(['b', 'c']);

    addSetDiff(target, previous, next);

    expect(target.has('a')).toBe(true);
    expect(target.has('c')).toBe(true);
    expect(target.has('b')).toBe(false);
    expect(target.size).toBe(2);
  });

  it('produces an empty target when previous and next are identical', () => {
    const target = new Set<string>();
    const previous = new Set(['x', 'y', 'z']);
    const next = new Set(['x', 'y', 'z']);

    addSetDiff(target, previous, next);

    expect(target.size).toBe(0);
  });

  it('handles both sets being empty', () => {
    const target = new Set<string>();
    const previous = new Set<string>();
    const next = new Set<string>();

    addSetDiff(target, previous, next);

    expect(target.size).toBe(0);
  });

  it('handles an empty previous set (all items in next are new)', () => {
    const target = new Set<string>();
    const previous = new Set<string>();
    const next = new Set(['a', 'b']);

    addSetDiff(target, previous, next);

    expect(target).toEqual(new Set(['a', 'b']));
  });

  it('handles an empty next set (all items in previous are removed)', () => {
    const target = new Set<string>();
    const previous = new Set(['a', 'b']);
    const next = new Set<string>();

    addSetDiff(target, previous, next);

    expect(target).toEqual(new Set(['a', 'b']));
  });

  it('handles completely disjoint sets', () => {
    const target = new Set<string>();
    const previous = new Set(['a', 'b']);
    const next = new Set(['c', 'd']);

    addSetDiff(target, previous, next);

    expect(target).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('appends to an existing target set without removing existing items', () => {
    const target = new Set<string>(['existing']);
    const previous = new Set(['a', 'b']);
    const next = new Set(['b', 'c']);

    addSetDiff(target, previous, next);

    expect(target).toEqual(new Set(['existing', 'a', 'c']));
    expect(target.size).toBe(3);
  });

  it('does not duplicate items already in the target', () => {
    const target = new Set<string>(['a']);
    const previous = new Set(['a', 'b']);
    const next = new Set(['b', 'c']);

    addSetDiff(target, previous, next);

    // 'a' was already in target, should still be size 3 not 4
    expect(target).toEqual(new Set(['a', 'c']));
    expect(target.size).toBe(2);
  });

  it('handles single-element sets', () => {
    const target = new Set<string>();
    const previous = new Set(['a']);
    const next = new Set(['b']);

    addSetDiff(target, previous, next);

    expect(target).toEqual(new Set(['a', 'b']));
  });

  it('handles single-element sets that are identical', () => {
    const target = new Set<string>();
    const previous = new Set(['a']);
    const next = new Set(['a']);

    addSetDiff(target, previous, next);

    expect(target.size).toBe(0);
  });

  it('handles large symmetric differences', () => {
    const target = new Set<string>();
    const previousItems = Array.from({ length: 100 }, (_, i) => `prev-${i}`);
    const nextItems = Array.from({ length: 100 }, (_, i) => `next-${i}`);
    const previous = new Set(previousItems);
    const next = new Set(nextItems);

    addSetDiff(target, previous, next);

    // All 200 items should be in the target since sets are fully disjoint
    expect(target.size).toBe(200);
    previousItems.forEach((item) => expect(target.has(item)).toBe(true));
    nextItems.forEach((item) => expect(target.has(item)).toBe(true));
  });

  it('handles overlapping sets with shared items excluded from target', () => {
    const target = new Set<string>();
    const previous = new Set(['a', 'b', 'c', 'd']);
    const next = new Set(['c', 'd', 'e', 'f']);

    addSetDiff(target, previous, next);

    // a, b removed; e, f added; c, d shared (not in diff)
    expect(target).toEqual(new Set(['a', 'b', 'e', 'f']));
    expect(target.has('c')).toBe(false);
    expect(target.has('d')).toBe(false);
  });
});
