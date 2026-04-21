import { createConsola } from 'consola';
import { describe, expect, it } from 'vitest';

import type { IFunctionCreateDTO } from '../../../../shared/types/dto/FunctionDTO';
import type { IMethodCreateDTO } from '../../../../shared/types/dto/MethodDTO';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';
import { ComplexityAnalyzer } from '../ComplexityAnalyzer';
import { createDefaultConfig } from '../../types';

/** Determine once whether the runtime package is importable. */
async function isTsMorphInstalled(): Promise<boolean> {
  try {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- probe for optional dep
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

describe.skipIf(missingTsMorph)('ComplexityAnalyzer', () => {
  it('has the expected static metadata', () => {
    const analyzer = new ComplexityAnalyzer();
    expect(analyzer.id).toBe('complexity');
    expect(analyzer.category).toBe('complexity');
    expect(analyzer.requires).toEqual(['tsMorph']);
    // Only runs under deep mode.
    expect(analyzer.enabled(createDefaultConfig())).toBe(false);
    expect(analyzer.enabled({ ...createDefaultConfig(), deep: true })).toBe(true);
  });

  it('returns an empty result when ctx.project is null', async () => {
    const parseResult = makeEmptyParseResult();
    const ctx = makeContext(parseResult, null);
    const result = await new ComplexityAnalyzer().run(ctx);
    expect(result.metrics ?? []).toHaveLength(0);
    expect(result.entityStats ?? []).toHaveLength(0);
  });

  it('computes cyclomatic/cognitive/max-nesting/logicalLines/parameterCount for a known function', async () => {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- in-memory fixture only loaded when ts-morph is present
    const { Project } = await import('ts-morph');

    // A function containing:
    //   - 1 if + 1 else (cyclomatic gets +1 for the if, else is not a new branch in cyclomatic terms)
    //   - 1 for-loop
    //   - 1 && binary
    // Cyclomatic = 1 + (if=1) + (for=1) + (&&=1) = 4
    // Parameter count = 2
    const code = [
      'export function sample(a: number, b: number) {',
      '  if (a > 0 && b > 0) {', // if (+1 cyclomatic, +1 cognitive nest=0 => 1, && +1 cognitive)
      '    for (let i = 0; i < a; i++) {', // for (+1 cyclomatic, +1+nest => 2 cognitive)
      '      b = b + i;',
      '    }',
      '  } else {',
      '    b = -1;',
      '  }',
      '  return b;',
      '}',
      '',
    ].join('\n');

    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true },
    });
    const sf = project.createSourceFile('/virtual/sample.ts', code);
    const filePath = sf.getFilePath();

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', String(filePath)));

    const fn: IFunctionCreateDTO = {
      id: 'fn-sample',
      package_id: 'pkg-test',
      module_id: 'mod-1',
      name: 'sample',
    };
    parseResult.functions.push(fn);

    const ctx = makeContext(parseResult, project);
    const result = await new ComplexityAnalyzer().run(ctx);

    // One entity resolved => one stats patch, five metrics.
    expect(result.entityStats).toBeDefined();
    expect(result.entityStats).toHaveLength(1);
    const patch = result.entityStats?.[0];
    expect(patch?.entity_id).toBe('fn-sample');
    expect(patch?.entity_type).toBe('function');
    expect(patch?.columns['cyclomatic']).toBe(4);
    expect(patch?.columns['parameter_count']).toBe(2);
    expect(patch?.columns['max_nesting']).toBeGreaterThanOrEqual(1);
    expect(patch?.columns['logical_lines']).toBeGreaterThan(0);
    // Cognitive is non-zero for a function with if/for/&& present.
    expect(patch?.columns['cognitive']).toBeGreaterThan(0);

    expect(result.metrics).toBeDefined();
    expect(result.metrics).toHaveLength(5);
    const byKey = new Map(result.metrics?.map((m) => [m.metric_key, m]));
    expect(byKey.get('complexity.cyclomatic')?.metric_value).toBe(4);
    expect(byKey.get('complexity.parameterCount')?.metric_value).toBe(2);
    expect(byKey.get('size.logicalLines')?.metric_value).toBeGreaterThan(0);
    expect(byKey.get('complexity.cognitive')?.metric_value).toBeGreaterThan(0);

    // All metric rows should carry the function entity metadata.
    for (const metric of result.metrics ?? []) {
      expect(metric.entity_id).toBe('fn-sample');
      expect(metric.entity_type).toBe('function');
      expect(metric.module_id).toBe('mod-1');
      expect(metric.package_id).toBe('pkg-test');
      expect(metric.snapshot_id).toBe('snap-test');
    }

    const cyclomaticMetric = byKey.get('complexity.cyclomatic');
    expect(cyclomaticMetric?.metric_category).toBe('complexity');
    const logicalLinesMetric = byKey.get('size.logicalLines');
    expect(logicalLinesMetric?.metric_category).toBe('size');
  });

  it('matches class methods via parent_type="class" lookup', async () => {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- in-memory fixture only loaded when ts-morph is present
    const { Project } = await import('ts-morph');

    const code = [
      'export class Calc {',
      '  add(a: number, b: number) { return a + b; }',
      '  riskyDiv(a: number, b: number) {',
      '    if (b === 0) throw new Error("div0");',
      '    return a / b;',
      '  }',
      '}',
      '',
    ].join('\n');

    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('/virtual/calc.ts', code);
    const filePath = sf.getFilePath();

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-calc', String(filePath)));

    const addMethod: IMethodCreateDTO = {
      id: 'method-add',
      package_id: 'pkg-test',
      module_id: 'mod-calc',
      parent_id: 'class-calc',
      parent_type: 'class',
      name: 'add',
      return_type: 'number',
      is_static: false,
      is_async: false,
      visibility: 'public',
    };
    const divMethod: IMethodCreateDTO = {
      id: 'method-riskyDiv',
      package_id: 'pkg-test',
      module_id: 'mod-calc',
      parent_id: 'class-calc',
      parent_type: 'class',
      name: 'riskyDiv',
      return_type: 'number',
      is_static: false,
      is_async: false,
      visibility: 'public',
    };
    parseResult.methods.push(addMethod, divMethod);

    const ctx = makeContext(parseResult, project);
    const result = await new ComplexityAnalyzer().run(ctx);

    expect(result.entityStats).toHaveLength(2);
    const addPatch = result.entityStats?.find((p) => p.entity_id === 'method-add');
    const divPatch = result.entityStats?.find((p) => p.entity_id === 'method-riskyDiv');
    expect(addPatch?.entity_type).toBe('method');
    expect(divPatch?.entity_type).toBe('method');

    // add() has no decision points => cyclomatic=1
    expect(addPatch?.columns['cyclomatic']).toBe(1);
    // riskyDiv has one if => cyclomatic=2
    expect(divPatch?.columns['cyclomatic']).toBe(2);
  });
});
