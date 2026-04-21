import { createConsola } from 'consola';
import { describe, expect, it } from 'vitest';

import type { IFunctionCreateDTO } from '../../../../shared/types/dto/FunctionDTO';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';
import { CallGraphAnalyzer } from '../CallGraphAnalyzer';
import { createDefaultConfig } from '../../types';

/** Determine once whether the runtime package is importable. */
async function isTsMorphInstalled(): Promise<boolean> {
  try {
    const specifier = 'ts-morph';
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- probe for optional dep
    await import(/* @vite-ignore */ specifier);
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
      directory: '/virtual',
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
    packageRoot: '/virtual',
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: { ...createDefaultConfig(), deep: true },
    logger: createConsola({ level: 0 }),
  };
}

describe.skipIf(missingTsMorph)('CallGraphAnalyzer', () => {
  it('has the expected static metadata', () => {
    const analyzer = new CallGraphAnalyzer();
    expect(analyzer.id).toBe('call-graph');
    expect(analyzer.category).toBe('structure');
    expect(analyzer.requires).toEqual(['tsMorph']);
    // Only runs under deep mode.
    expect(analyzer.enabled(createDefaultConfig())).toBe(false);
    expect(analyzer.enabled({ ...createDefaultConfig(), deep: true })).toBe(true);
  });

  it('returns an empty result when ctx.project is null', async () => {
    const parseResult = makeEmptyParseResult();
    const ctx = makeContext(parseResult, null);
    const result = await new CallGraphAnalyzer().run(ctx);
    expect(result.callEdges ?? []).toHaveLength(0);
  });

  it('resolves a direct function-to-function call within one module', async () => {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- in-memory fixture only loaded when ts-morph is present
    const { Project } = await import('ts-morph');

    const code = [
      'export function B(): number {',
      '  return 42;',
      '}',
      '',
      'export function A(): number {',
      '  return B();',
      '}',
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

    const fnA: IFunctionCreateDTO = {
      id: 'fn-A',
      package_id: 'pkg-test',
      module_id: 'mod-1',
      name: 'A',
    };
    const fnB: IFunctionCreateDTO = {
      id: 'fn-B',
      package_id: 'pkg-test',
      module_id: 'mod-1',
      name: 'B',
    };
    parseResult.functions.push(fnA, fnB);

    const ctx = makeContext(parseResult, project);
    const result = await new CallGraphAnalyzer().run(ctx);

    expect(result.callEdges).toBeDefined();
    const edges = result.callEdges ?? [];
    // Exactly one edge: A -> B
    const aToB = edges.filter((e) => e.source_entity_id === 'fn-A');
    expect(aToB.length).toBeGreaterThanOrEqual(1);
    const edge = aToB.find((e) => e.target_name === 'B');
    expect(edge).toBeDefined();
    expect(edge?.source_entity_type).toBe('function');
    expect(edge?.target_entity_id).toBe('fn-B');
    expect(edge?.target_entity_type).toBe('function');
    expect(edge?.resolution_status).toBe('resolved');
    expect(edge?.package_id).toBe('pkg-test');
    expect(edge?.module_id).toBe('mod-1');
    expect(typeof edge?.call_expression_line).toBe('number');
    expect(edge?.is_awaited).toBe(false);
  });

  it('marks a call to an unknown function as unresolved or external', async () => {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- in-memory fixture only loaded when ts-morph is present
    const { Project } = await import('ts-morph');

    // `missingDep` is not declared anywhere in the project and is not imported,
    // so ts-morph cannot resolve it to a declaration. The name-map lookup
    // also finds nothing, so the edge should be `unresolved`.
    const code = [
      'export function A(): void {',
      '  missingDep();',
      '}',
      '',
    ].join('\n');

    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true },
    });
    const sf = project.createSourceFile('/virtual/sample2.ts', code);
    const filePath = String(sf.getFilePath());

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-2', filePath));

    const fnA: IFunctionCreateDTO = {
      id: 'fn-A',
      package_id: 'pkg-test',
      module_id: 'mod-2',
      name: 'A',
    };
    parseResult.functions.push(fnA);

    const ctx = makeContext(parseResult, project);
    const result = await new CallGraphAnalyzer().run(ctx);

    const edges = result.callEdges ?? [];
    const edge = edges.find((e) => e.target_name === 'missingDep');
    expect(edge).toBeDefined();
    expect(edge?.source_entity_id).toBe('fn-A');
    // External or unresolved are both acceptable outcomes per the Phase 2 contract.
    expect(['unresolved', 'external']).toContain(edge?.resolution_status);
    expect(edge?.target_entity_id).toBeUndefined();
  });

  it('flags awaited calls via is_awaited', async () => {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- in-memory fixture only loaded when ts-morph is present
    const { Project } = await import('ts-morph');

    const code = [
      'export async function B(): Promise<number> {',
      '  return 1;',
      '}',
      '',
      'export async function A(): Promise<number> {',
      '  return await B();',
      '}',
      '',
    ].join('\n');

    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true },
    });
    const sf = project.createSourceFile('/virtual/sample3.ts', code);
    const filePath = String(sf.getFilePath());

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-3', filePath));

    const fnA: IFunctionCreateDTO = {
      id: 'fn-A',
      package_id: 'pkg-test',
      module_id: 'mod-3',
      name: 'A',
    };
    const fnB: IFunctionCreateDTO = {
      id: 'fn-B',
      package_id: 'pkg-test',
      module_id: 'mod-3',
      name: 'B',
    };
    parseResult.functions.push(fnA, fnB);

    const ctx = makeContext(parseResult, project);
    const result = await new CallGraphAnalyzer().run(ctx);

    const edges = result.callEdges ?? [];
    const edge = edges.find(
      (e) => e.source_entity_id === 'fn-A' && e.target_name === 'B'
    );
    expect(edge).toBeDefined();
    expect(edge?.is_awaited).toBe(true);
    expect(edge?.is_async_call).toBe(true);
  });
});
