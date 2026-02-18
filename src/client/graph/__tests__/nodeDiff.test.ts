import type { DependencyNode } from '../../types/DependencyNode';
import { collectNodesNeedingInternalsUpdate } from '../nodeDiff';

/**
 * Helper to build a minimal DependencyNode for testing.
 * Only the fields relevant to `collectNodesNeedingInternalsUpdate` are required.
 */
const makeNode = (overrides: Partial<DependencyNode> & { id: string }): DependencyNode => {
  return {
    position: { x: 0, y: 0 },
    data: { label: overrides.id },
    ...overrides,
  } as DependencyNode;
};

describe('collectNodesNeedingInternalsUpdate', () => {
  // -----------------------------------------------------------------------
  // Empty / trivial cases
  // -----------------------------------------------------------------------

  it('returns an empty array when both arrays are empty', () => {
    expect(collectNodesNeedingInternalsUpdate([], [])).toEqual([]);
  });

  it('returns an empty array when next is empty (all removed)', () => {
    const previous = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    expect(collectNodesNeedingInternalsUpdate(previous, [])).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Added nodes
  // -----------------------------------------------------------------------

  it('reports all nodes as changed when previous is empty (all added)', () => {
    const next = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const result = collectNodesNeedingInternalsUpdate([], next);
    expect(result).toEqual(['a', 'b']);
  });

  it('reports a single newly added node', () => {
    const previous = [makeNode({ id: 'a' })];
    const next = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const result = collectNodesNeedingInternalsUpdate(previous, next);
    expect(result).toEqual(['b']);
  });

  // -----------------------------------------------------------------------
  // Identical arrays (no changes)
  // -----------------------------------------------------------------------

  it('returns an empty array when previous and next are identical', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })];
    expect(collectNodesNeedingInternalsUpdate(nodes, nodes)).toEqual([]);
  });

  it('returns an empty array for structurally equal nodes (different references)', () => {
    const previous = [makeNode({ id: 'x', position: { x: 10, y: 20 } })];
    const next = [makeNode({ id: 'x', position: { x: 10, y: 20 } })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Completely different arrays
  // -----------------------------------------------------------------------

  it('reports all next nodes when sets are completely disjoint', () => {
    const previous = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const next = [makeNode({ id: 'c' }), makeNode({ id: 'd' }), makeNode({ id: 'e' })];
    const result = collectNodesNeedingInternalsUpdate(previous, next);
    expect(result).toEqual(['c', 'd', 'e']);
  });

  // -----------------------------------------------------------------------
  // sourcePosition / targetPosition / parentNode changes
  // -----------------------------------------------------------------------

  it('detects a sourcePosition change', () => {
    const previous = [makeNode({ id: 'a', sourcePosition: 'left' as never })];
    const next = [makeNode({ id: 'a', sourcePosition: 'right' as never })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects a targetPosition change', () => {
    const previous = [makeNode({ id: 'a', targetPosition: 'top' as never })];
    const next = [makeNode({ id: 'a', targetPosition: 'bottom' as never })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects a parentNode change', () => {
    const previous = [makeNode({ id: 'a', parentNode: 'parent1' })];
    const next = [makeNode({ id: 'a', parentNode: 'parent2' })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects parentNode added where there was none', () => {
    const previous = [makeNode({ id: 'a' })];
    const next = [makeNode({ id: 'a', parentNode: 'parent1' })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects parentNode removed', () => {
    const previous = [makeNode({ id: 'a', parentNode: 'parent1' })];
    const next = [makeNode({ id: 'a' })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  // -----------------------------------------------------------------------
  // Dimension changes via measured property
  // -----------------------------------------------------------------------

  it('detects a width change via measured property', () => {
    const previous = [makeNode({ id: 'a' })];
    Object.assign(previous[0], { measured: { width: 100, height: 50 } });

    const next = [makeNode({ id: 'a' })];
    Object.assign(next[0], { measured: { width: 200, height: 50 } });

    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects a height change via measured property', () => {
    const previous = [makeNode({ id: 'a' })];
    Object.assign(previous[0], { measured: { width: 100, height: 50 } });

    const next = [makeNode({ id: 'a' })];
    Object.assign(next[0], { measured: { width: 100, height: 200 } });

    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('ignores dimension changes within the 1px tolerance', () => {
    const previous = [makeNode({ id: 'a' })];
    Object.assign(previous[0], { measured: { width: 100, height: 50 } });

    const next = [makeNode({ id: 'a' })];
    Object.assign(next[0], { measured: { width: 100.5, height: 50.5 } });

    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  it('flags a change at exactly the 1px boundary (> 1, not >=)', () => {
    const previous = [makeNode({ id: 'a' })];
    Object.assign(previous[0], { measured: { width: 100, height: 50 } });

    // Exactly 1px difference -- should NOT be flagged (threshold is > 1)
    const next1px = [makeNode({ id: 'a' })];
    Object.assign(next1px[0], { measured: { width: 101, height: 50 } });
    expect(collectNodesNeedingInternalsUpdate(previous, next1px)).toEqual([]);

    // 1.01px difference -- should be flagged
    const nextOver1px = [makeNode({ id: 'a' })];
    Object.assign(nextOver1px[0], { measured: { width: 101.01, height: 50 } });
    expect(collectNodesNeedingInternalsUpdate(previous, nextOver1px)).toEqual(['a']);
  });

  // -----------------------------------------------------------------------
  // Dimension changes via style property
  // -----------------------------------------------------------------------

  it('detects a width change via style property', () => {
    const previous = [makeNode({ id: 'a', style: { width: '100px' } })];
    const next = [makeNode({ id: 'a', style: { width: '250px' } })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects a height change via style property', () => {
    const previous = [makeNode({ id: 'a', style: { height: 100 } })];
    const next = [makeNode({ id: 'a', style: { height: 300 } })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  // -----------------------------------------------------------------------
  // Dimension changes via node.width / node.height
  // -----------------------------------------------------------------------

  it('detects a width change via node.width', () => {
    const previous = [makeNode({ id: 'a', width: 100 })];
    const next = [makeNode({ id: 'a', width: 200 })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('detects a height change via node.height', () => {
    const previous = [makeNode({ id: 'a', height: 80 })];
    const next = [makeNode({ id: 'a', height: 200 })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  // -----------------------------------------------------------------------
  // Dimension priority: measured > style > node.width/height
  // -----------------------------------------------------------------------

  it('prefers measured dimensions over style dimensions', () => {
    // Both have the same measured values but different style values.
    // Since measured takes priority, no change should be detected.
    const previous = [makeNode({ id: 'a', style: { width: '100px' } })];
    Object.assign(previous[0], { measured: { width: 200, height: 50 } });

    const next = [makeNode({ id: 'a', style: { width: '300px' } })];
    Object.assign(next[0], { measured: { width: 200, height: 50 } });

    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  it('prefers style dimensions over node.width/height', () => {
    // Both have the same style values but different node.width values.
    // Since style takes priority over node.width, no change should be detected.
    const previous = [makeNode({ id: 'a', style: { width: '150px' }, width: 100 })];
    const next = [makeNode({ id: 'a', style: { width: '150px' }, width: 300 })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Mixed scenarios
  // -----------------------------------------------------------------------

  it('correctly identifies a mix of added, unchanged, and modified nodes', () => {
    const previous = [
      makeNode({ id: 'unchanged', width: 100, height: 100 }),
      makeNode({ id: 'modified', width: 100, height: 100 }),
      makeNode({ id: 'removed', width: 100, height: 100 }),
    ];

    const next = [
      makeNode({ id: 'unchanged', width: 100, height: 100 }),
      makeNode({ id: 'modified', width: 300, height: 100 }),
      makeNode({ id: 'added', width: 100, height: 100 }),
    ];

    const result = collectNodesNeedingInternalsUpdate(previous, next);
    expect(result).toContain('modified');
    expect(result).toContain('added');
    expect(result).not.toContain('unchanged');
    // 'removed' is not in next, so it should not appear
    expect(result).not.toContain('removed');
  });

  it('handles single-element arrays with no change', () => {
    const previous = [makeNode({ id: 'solo', width: 50 })];
    const next = [makeNode({ id: 'solo', width: 50 })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  it('handles single-element arrays with a change', () => {
    const previous = [makeNode({ id: 'solo', width: 50 })];
    const next = [makeNode({ id: 'solo', width: 200 })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['solo']);
  });

  // -----------------------------------------------------------------------
  // Edge cases: undefined / missing dimension values
  // -----------------------------------------------------------------------

  it('treats missing dimensions as 0, so both missing means no change', () => {
    // No measured, no style, no width/height -- both resolve to 0x0
    const previous = [makeNode({ id: 'a' })];
    const next = [makeNode({ id: 'a' })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  it('detects change when one side has dimensions and the other does not', () => {
    const previous = [makeNode({ id: 'a' })];
    const next = [makeNode({ id: 'a', width: 200 })];
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual(['a']);
  });

  it('handles non-object style gracefully (falls back to empty object)', () => {
    const previous = [makeNode({ id: 'a', style: 'color: red' as never })];
    const next = [makeNode({ id: 'a', style: 'color: blue' as never })];
    // Non-object styles should be treated as {} -- both have 0x0, no change
    expect(collectNodesNeedingInternalsUpdate(previous, next)).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Multiple changes on the same node (only reported once)
  // -----------------------------------------------------------------------

  it('reports a node only once even when multiple properties differ', () => {
    const previous = [makeNode({ id: 'a', sourcePosition: 'left' as never, width: 100 })];
    const next = [makeNode({ id: 'a', sourcePosition: 'right' as never, width: 300 })];
    const result = collectNodesNeedingInternalsUpdate(previous, next);
    // Should contain 'a' exactly once (early return after sourcePosition check)
    expect(result).toEqual(['a']);
  });
});
