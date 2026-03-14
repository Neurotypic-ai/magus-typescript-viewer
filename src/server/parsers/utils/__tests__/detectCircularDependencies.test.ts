import { describe, expect, it } from 'vitest';

import { detectCircularDependencies } from '../detectCircularDependencies';

import type { CircularDependency, ModuleDescriptor } from '../detectCircularDependencies';

describe('detectCircularDependencies', () => {
  it('returns an empty array when there are no cycles (linear chain)', () => {
    const modules: ModuleDescriptor[] = [
      { path: 'a.ts', imports: [{ source: 'b.ts' }] },
      { path: 'b.ts', imports: [{ source: 'c.ts' }] },
      { path: 'c.ts', imports: [] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toEqual([]);
  });

  it('detects a simple A -> B -> A cycle', () => {
    const modules: ModuleDescriptor[] = [
      { path: 'a.ts', imports: [{ source: 'b.ts' }] },
      { path: 'b.ts', imports: [{ source: 'a.ts' }] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toHaveLength(1);
    expectCycleContains(result[0]!, ['a.ts', 'b.ts']);
  });

  it('detects a complex A -> B -> C -> A cycle', () => {
    const modules: ModuleDescriptor[] = [
      { path: 'a.ts', imports: [{ source: 'b.ts' }] },
      { path: 'b.ts', imports: [{ source: 'c.ts' }] },
      { path: 'c.ts', imports: [{ source: 'a.ts' }] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toHaveLength(1);
    expectCycleContains(result[0]!, ['a.ts', 'b.ts', 'c.ts']);
    expect(result[0]!.length).toBe(3);
  });

  it('detects a self-referencing module', () => {
    const modules: ModuleDescriptor[] = [
      { path: 'self.ts', imports: [{ source: 'self.ts' }] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toHaveLength(1);
    expect(result[0]!.cycle).toEqual(['self.ts']);
    expect(result[0]!.length).toBe(1);
  });

  it('detects multiple independent cycles', () => {
    const modules: ModuleDescriptor[] = [
      // Cycle 1: a <-> b
      { path: 'a.ts', imports: [{ source: 'b.ts' }] },
      { path: 'b.ts', imports: [{ source: 'a.ts' }] },
      // Cycle 2: x -> y -> z -> x
      { path: 'x.ts', imports: [{ source: 'y.ts' }] },
      { path: 'y.ts', imports: [{ source: 'z.ts' }] },
      { path: 'z.ts', imports: [{ source: 'x.ts' }] },
      // No cycle: standalone
      { path: 'standalone.ts', imports: [] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toHaveLength(2);

    const cyclePaths = result.map((c) => [...c.cycle].sort().join(','));
    expect(cyclePaths).toContain('a.ts,b.ts');
    expect(cyclePaths).toContain('x.ts,y.ts,z.ts');
  });

  it('returns an empty array for modules with no imports', () => {
    const modules: ModuleDescriptor[] = [
      { path: 'a.ts', imports: [] },
      { path: 'b.ts', imports: [] },
      { path: 'c.ts', imports: [] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toEqual([]);
  });

  it('ignores imports to unknown/external modules', () => {
    const modules: ModuleDescriptor[] = [
      { path: 'a.ts', imports: [{ source: 'lodash' }, { source: 'b.ts' }] },
      { path: 'b.ts', imports: [{ source: 'react' }] },
    ];

    const result = detectCircularDependencies(modules);

    expect(result).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    const result = detectCircularDependencies([]);

    expect(result).toEqual([]);
  });

  it('deduplicates the same cycle detected from different starting nodes', () => {
    // A -> B -> C -> A can be found starting from A, B, or C
    const modules: ModuleDescriptor[] = [
      { path: 'a.ts', imports: [{ source: 'b.ts' }] },
      { path: 'b.ts', imports: [{ source: 'c.ts' }] },
      { path: 'c.ts', imports: [{ source: 'a.ts' }] },
    ];

    const result = detectCircularDependencies(modules);

    // Should only report one cycle, not three
    expect(result).toHaveLength(1);
  });
});

/**
 * Asserts that a CircularDependency contains exactly the expected paths
 * (order-independent, since cycles can be reported starting from any node).
 */
function expectCycleContains(dep: CircularDependency, expectedPaths: string[]): void {
  expect(dep.cycle).toHaveLength(expectedPaths.length);
  expect([...dep.cycle].sort()).toEqual([...expectedPaths].sort());
  expect(dep.length).toBe(expectedPaths.length);
}
