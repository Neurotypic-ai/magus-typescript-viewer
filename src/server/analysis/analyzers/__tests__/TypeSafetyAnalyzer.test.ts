import { createConsola } from 'consola';
import { describe, expect, it } from 'vitest';

import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';
import { TypeSafetyAnalyzer } from '../TypeSafetyAnalyzer';
import { createDefaultConfig } from '../../types';

/** Determine once whether the runtime package is importable. */
async function isTsMorphInstalled(): Promise<boolean> {
  try {
    await import('ts-morph');
    return true;
  } catch {
    return false;
  }
}

const missingTsMorph = !(await isTsMorphInstalled());

function makeEmptyParseResult(): ParseResult {
  return {
    modules: [],
    classes: [],
    interfaces: [],
    functions: [],
    typeAliases: [],
    enums: [],
    variables: [],
    methods: [],
    properties: [],
    parameters: [],
    imports: [],
    exports: [],
    classExtends: [],
    classImplements: [],
    interfaceExtends: [],
    symbolUsages: [],
    symbolReferences: [],
  };
}

function makeModule(id: string, filename: string): IModuleCreateDTO {
  return {
    id,
    package_id: 'pkg-test',
    name: 'fixture',
    source: {
      directory: '/tmp',
      name: 'fixture',
      filename,
      relativePath: 'fixture.ts',
    },
  };
}

function makeContext(parseResult: ParseResult, project: unknown): AnalyzerContext {
  return {
    parseResult,
    project,
    packageRoot: '/tmp',
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: { ...createDefaultConfig(), deep: true },
    logger: createConsola({ level: 0 }),
  };
}

describe.skipIf(missingTsMorph)('TypeSafetyAnalyzer', () => {
  it('has the expected static metadata', () => {
    const analyzer = new TypeSafetyAnalyzer();
    expect(analyzer.id).toBe('type-safety');
    expect(analyzer.category).toBe('typeSafety');
    expect(analyzer.requires).toEqual(['tsMorph']);
    // Only runs under deep mode.
    expect(analyzer.enabled(createDefaultConfig())).toBe(false);
    expect(analyzer.enabled({ ...createDefaultConfig(), deep: true })).toBe(true);
  });

  it('returns an empty result when ctx.project is null', async () => {
    const parseResult = makeEmptyParseResult();
    const ctx = makeContext(parseResult, null);
    const result = await new TypeSafetyAnalyzer().run(ctx);
    expect(result.metrics ?? []).toHaveLength(0);
    expect(result.entityStats ?? []).toHaveLength(0);
  });

  it('counts any / unknown / as / non-null assertions for a known source', async () => {
    const { Project } = await import('ts-morph');

    const code = [
      'const x: any = 1;',
      'const y: unknown = 2;',
      'const z = 3 as number;',
      'declare const foo: { bar: string } | null;',
      'const nn = foo!;',
      '',
    ].join('\n');

    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true },
    });
    const sf = project.createSourceFile('/virtual/sample.ts', code);
    const filePath = String(sf.getFilePath());

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', filePath));

    const ctx = makeContext(parseResult, project);
    const result = await new TypeSafetyAnalyzer().run(ctx);

    expect(result.metrics).toBeDefined();
    const byKey = new Map(result.metrics?.map((m) => [m.metric_key, m]));

    expect(byKey.get('typeSafety.anyCount')?.metric_value).toBe(1);
    expect(byKey.get('typeSafety.unknownCount')?.metric_value).toBe(1);
    expect(byKey.get('typeSafety.asAssertionCount')?.metric_value).toBe(1);
    expect(byKey.get('typeSafety.nonNullAssertionCount')?.metric_value).toBe(1);

    // Ancillary metrics should also be emitted and well-formed.
    expect(byKey.get('typeSafety.angleAssertionCount')?.metric_value).toBe(0);
    expect(byKey.get('typeSafety.tsIgnoreCount')?.metric_value).toBe(0);
    const totalIdentifiers = byKey.get('typeSafety.totalIdentifiers')?.metric_value ?? 0;
    expect(totalIdentifiers).toBeGreaterThan(0);

    // Density = anyCount / max(totalIdentifiers, 1)
    const density = byKey.get('typeSafety.anyDensity')?.metric_value ?? -1;
    expect(density).toBeGreaterThan(0);
    expect(density).toBeCloseTo(1 / totalIdentifiers, 10);

    for (const metric of result.metrics ?? []) {
      expect(metric.entity_id).toBe('mod-1');
      expect(metric.entity_type).toBe('module');
      expect(metric.module_id).toBe('mod-1');
      expect(metric.package_id).toBe('pkg-test');
      expect(metric.snapshot_id).toBe('snap-test');
      expect(metric.metric_category).toBe('typeSafety');
    }
  });

  it('counts @ts-ignore / @ts-expect-error comments', async () => {
    const { Project } = await import('ts-morph');
    const code = [
      '// @ts-ignore',
      'const a = (1 as unknown) as string;',
      '// @ts-expect-error because reasons',
      'const b = 2;',
      '/* @ts-ignore in a block */',
      'const c = 3;',
      '',
    ].join('\n');

    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('/virtual/ignores.ts', code);
    const filePath = String(sf.getFilePath());

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-ign', filePath));

    const ctx = makeContext(parseResult, project);
    const result = await new TypeSafetyAnalyzer().run(ctx);

    const byKey = new Map(result.metrics?.map((m) => [m.metric_key, m]));
    expect(byKey.get('typeSafety.tsIgnoreCount')?.metric_value).toBe(3);
  });

  it('skips source files whose path does not match any ParseResult module', async () => {
    const { Project } = await import('ts-morph');
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/virtual/unmatched.ts', 'const n: any = 1;\n');

    const parseResult = makeEmptyParseResult();
    // No modules added — the unmatched file should be skipped silently.

    const ctx = makeContext(parseResult, project);
    const result = await new TypeSafetyAnalyzer().run(ctx);

    expect(result.metrics ?? []).toHaveLength(0);
    expect(result.entityStats ?? []).toHaveLength(0);
  });
});
