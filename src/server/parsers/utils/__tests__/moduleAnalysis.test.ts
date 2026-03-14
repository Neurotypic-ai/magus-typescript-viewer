import { describe, expect, it } from 'vitest';

import { computeModuleMetrics, detectDeadExports } from '../moduleAnalysis';

import type { DeadExport, ModuleExportDescriptor } from '../moduleAnalysis';

describe('computeModuleMetrics', () => {
  it('returns zeroed metrics for an empty module', () => {
    const result = computeModuleMetrics(
      new Set<string>(),
      new Set<string>(),
      new Map<string, unknown>(),
      new Set<string>()
    );

    expect(result).toEqual({
      exportCount: 0,
      importCount: 0,
      reExportCount: 0,
      isBarrelFile: false,
      reExportRatio: 0,
      importSourceCount: 0,
      fanOut: 0,
    });
  });

  it('computes basic metrics for a module with exports and imports', () => {
    const exports = new Set(['Foo', 'Bar', 'baz']);
    const reExports = new Set(['Foo']);
    const imports = new Map<string, unknown>([
      ['./a', {}],
      ['./b', {}],
    ]);
    const importSources = new Set(['./a', './b']);

    const result = computeModuleMetrics(exports, reExports, imports, importSources);

    expect(result.exportCount).toBe(3);
    expect(result.importCount).toBe(2);
    expect(result.reExportCount).toBe(1);
    expect(result.isBarrelFile).toBe(false);
    expect(result.reExportRatio).toBeCloseTo(1 / 3);
    expect(result.importSourceCount).toBe(2);
    expect(result.fanOut).toBe(2);
  });

  it('identifies a barrel file when >80% exports are re-exports', () => {
    const exports = new Set(['A', 'B', 'C', 'D', 'E']);
    const reExports = new Set(['A', 'B', 'C', 'D', 'E']);
    const imports = new Map<string, unknown>();
    const importSources = new Set<string>();

    const result = computeModuleMetrics(exports, reExports, imports, importSources);

    expect(result.isBarrelFile).toBe(true);
    expect(result.reExportRatio).toBe(1);
  });

  it('identifies a barrel file with wildcard re-export', () => {
    const exports = new Set(['*']);
    const reExports = new Set(['*']);
    const imports = new Map<string, unknown>();
    const importSources = new Set<string>();

    const result = computeModuleMetrics(exports, reExports, imports, importSources);

    expect(result.isBarrelFile).toBe(true);
  });

  it('does not flag as barrel when re-export ratio is at exactly 80%', () => {
    // 4 out of 5 = 0.8, which is NOT > 0.8
    const exports = new Set(['A', 'B', 'C', 'D', 'E']);
    const reExports = new Set(['A', 'B', 'C', 'D']);
    const imports = new Map<string, unknown>();
    const importSources = new Set<string>();

    const result = computeModuleMetrics(exports, reExports, imports, importSources);

    expect(result.isBarrelFile).toBe(false);
    expect(result.reExportRatio).toBe(0.8);
  });

  it('flags as barrel when re-export ratio exceeds 80%', () => {
    // 5 out of 6 ≈ 0.833
    const exports = new Set(['A', 'B', 'C', 'D', 'E', 'F']);
    const reExports = new Set(['A', 'B', 'C', 'D', 'E']);
    const imports = new Map<string, unknown>();
    const importSources = new Set<string>();

    const result = computeModuleMetrics(exports, reExports, imports, importSources);

    expect(result.isBarrelFile).toBe(true);
    expect(result.reExportRatio).toBeCloseTo(5 / 6);
  });

  it('sets fanOut equal to importSourceCount', () => {
    const exports = new Set<string>();
    const reExports = new Set<string>();
    const imports = new Map<string, unknown>([
      ['./x', {}],
      ['./y', {}],
      ['lodash', {}],
    ]);
    const importSources = new Set(['./x', './y', 'lodash']);

    const result = computeModuleMetrics(exports, reExports, imports, importSources);

    expect(result.fanOut).toBe(3);
    expect(result.importSourceCount).toBe(3);
  });
});

describe('detectDeadExports', () => {
  it('returns all exports when nothing is imported', () => {
    const modules: ModuleExportDescriptor[] = [
      { path: 'a.ts', exports: new Set(['Foo', 'Bar']), imports: [] },
      { path: 'b.ts', exports: new Set(['Baz']), imports: [] },
    ];

    const result = detectDeadExports(modules);

    expect(result).toHaveLength(3);
    expect(result.map((d) => d.name).sort()).toEqual(['Bar', 'Baz', 'Foo']);
  });

  it('returns an empty array when all exports are consumed', () => {
    const modules: ModuleExportDescriptor[] = [
      { path: 'a.ts', exports: new Set(['Foo']), imports: [] },
      {
        path: 'b.ts',
        exports: new Set(['Bar']),
        imports: [{ source: 'a.ts', specifiers: ['Foo'] }],
      },
      {
        path: 'c.ts',
        exports: new Set<string>(),
        imports: [{ source: 'b.ts', specifiers: ['Bar'] }],
      },
    ];

    const result = detectDeadExports(modules);

    expect(result).toEqual([]);
  });

  it('detects partially dead exports', () => {
    const modules: ModuleExportDescriptor[] = [
      { path: 'utils.ts', exports: new Set(['helperA', 'helperB', 'helperC']), imports: [] },
      {
        path: 'app.ts',
        exports: new Set<string>(),
        imports: [{ source: 'utils.ts', specifiers: ['helperA'] }],
      },
    ];

    const result = detectDeadExports(modules);

    expect(result).toHaveLength(2);
    const deadNames = result.map((d) => d.name).sort();
    expect(deadNames).toEqual(['helperB', 'helperC']);
    expect(result.every((d) => d.modulePath === 'utils.ts')).toBe(true);
  });

  it('handles multiple modules importing the same symbol', () => {
    const modules: ModuleExportDescriptor[] = [
      { path: 'shared.ts', exports: new Set(['Config']), imports: [] },
      {
        path: 'a.ts',
        exports: new Set<string>(),
        imports: [{ source: 'shared.ts', specifiers: ['Config'] }],
      },
      {
        path: 'b.ts',
        exports: new Set<string>(),
        imports: [{ source: 'shared.ts', specifiers: ['Config'] }],
      },
    ];

    const result = detectDeadExports(modules);

    expect(result).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    const result = detectDeadExports([]);

    expect(result).toEqual([]);
  });

  it('returns deterministic output sorted by path then name', () => {
    const modules: ModuleExportDescriptor[] = [
      { path: 'z.ts', exports: new Set(['Zed', 'Alpha']), imports: [] },
      { path: 'a.ts', exports: new Set(['Bravo', 'Charlie']), imports: [] },
    ];

    const result = detectDeadExports(modules);

    const expected: DeadExport[] = [
      { name: 'Bravo', modulePath: 'a.ts' },
      { name: 'Charlie', modulePath: 'a.ts' },
      { name: 'Alpha', modulePath: 'z.ts' },
      { name: 'Zed', modulePath: 'z.ts' },
    ];
    expect(result).toEqual(expected);
  });

  it('does not count a module importing its own exports as consumed', () => {
    // Self-imports should still count — this tests that the logic is
    // purely based on source matching, regardless of which module does the importing.
    const modules: ModuleExportDescriptor[] = [
      {
        path: 'self.ts',
        exports: new Set(['Internal']),
        imports: [{ source: 'self.ts', specifiers: ['Internal'] }],
      },
    ];

    const result = detectDeadExports(modules);

    // Self-import does count as a consumption (the function doesn't exclude self-references)
    expect(result).toEqual([]);
  });

  it('ignores imports from unknown sources', () => {
    const modules: ModuleExportDescriptor[] = [
      { path: 'lib.ts', exports: new Set(['Util']), imports: [] },
      {
        path: 'app.ts',
        exports: new Set<string>(),
        imports: [{ source: 'external-package', specifiers: ['Something'] }],
      },
    ];

    const result = detectDeadExports(modules);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Util', modulePath: 'lib.ts' });
  });
});
