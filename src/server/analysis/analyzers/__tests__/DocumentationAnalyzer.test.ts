import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConsola } from 'consola';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ParseResult } from '../../../parsers/ParseResult';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { AnalyzerContext } from '../../types';
import { createDefaultConfig } from '../../types';
import { DocumentationAnalyzer } from '../DocumentationAnalyzer';
import { createTsMorphProject } from '../../tsmorph/SharedProject';

/**
 * Probe for ts-morph: if the optional dep isn't installed, every test in this
 * file is skipped. The analyzer itself is defensive about this, but the tests
 * require a real ts-morph Project to exercise the walk code paths.
 */
async function isTsMorphInstalled(): Promise<boolean> {
  const specifier = 'ts-morph';
  try {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- probe for optional dep
    await import(/* @vite-ignore */ specifier);
    return true;
  } catch {
    return false;
  }
}

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

function makeContext(
  parseResult: ParseResult,
  project: unknown,
  overrides: Partial<AnalyzerContext> = {}
): AnalyzerContext {
  return {
    parseResult,
    project,
    packageRoot: '/tmp',
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: { ...createDefaultConfig(), deep: true },
    logger: createConsola({ level: 0 }),
    ...overrides,
  };
}

const missingTsMorph = !(await isTsMorphInstalled());

describe.skipIf(missingTsMorph)('DocumentationAnalyzer', () => {
  let tmpDir: string;
  let fixturePath: string;
  let project: unknown;

  // Fixture: one documented function (with @param, @returns, @throws Error)
  // and one undocumented function. Expected docCoverage = 0.5.
  const fixtureSource = [
    '/**',
    ' * Adds one to the given number.',
    ' * @param n - the input number',
    ' * @returns the input plus one',
    ' * @throws Error when n is negative',
    ' */',
    'export function addOne(n: number): number {',
    '  if (n < 0) {',
    '    throw new Error("negative");',
    '  }',
    '  return n + 1;',
    '}',
    '',
    'export function bare(x: number): number {',
    '  return x * 2;',
    '}',
    '',
  ].join('\n');

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'doc-analyzer-test-'));
    fixturePath = join(tmpDir, 'fixture.ts');
    await writeFile(fixturePath, fixtureSource, 'utf-8');
    // Minimal tsconfig so ts-morph can adopt the fixture.
    await writeFile(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
          },
          include: ['**/*.ts'],
        },
        null,
        2
      )
    );
    project = await createTsMorphProject(tmpDir);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exposes the expected static metadata', () => {
    const analyzer = new DocumentationAnalyzer();
    expect(analyzer.id).toBe('documentation');
    expect(analyzer.category).toBe('documentation');
    expect(analyzer.requires).toEqual(['tsMorph']);
  });

  it('is gated on config.deep', () => {
    const analyzer = new DocumentationAnalyzer();
    const off = createDefaultConfig();
    expect(analyzer.enabled(off)).toBe(false);
    const on = { ...createDefaultConfig(), deep: true };
    expect(analyzer.enabled(on)).toBe(true);
  });

  it('returns an empty result when ctx.project is null', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', fixturePath));
    const ctx = makeContext(parseResult, null);

    const result = await new DocumentationAnalyzer().run(ctx);

    expect(result.metrics ?? []).toHaveLength(0);
    expect(result.entityStats ?? []).toHaveLength(0);
  });

  it('computes docCoverage = 0.5 for a module with one documented and one undocumented function', async () => {
    expect(project).not.toBeNull();
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', fixturePath));
    const ctx = makeContext(parseResult, project);

    const result = await new DocumentationAnalyzer().run(ctx);

    const metrics = result.metrics ?? [];
    const byKey = new Map(metrics.map((m) => [m.metric_key, m]));
    const coverage = byKey.get('documentation.docCoverage');
    expect(coverage).toBeDefined();
    expect(coverage?.metric_value).toBeCloseTo(0.5, 5);
    expect(coverage?.entity_type).toBe('module');
    expect(coverage?.entity_id).toBe('mod-1');
    expect(coverage?.module_id).toBe('mod-1');
    expect(coverage?.metric_category).toBe('documentation');
  });

  it('counts @throws tags in the module throwsCount metric', async () => {
    expect(project).not.toBeNull();
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', fixturePath));
    const ctx = makeContext(parseResult, project);

    const result = await new DocumentationAnalyzer().run(ctx);

    const metrics = result.metrics ?? [];
    const byKey = new Map(metrics.map((m) => [m.metric_key, m]));
    const throwsMetric = byKey.get('documentation.throwsCount');
    expect(throwsMetric).toBeDefined();
    expect(throwsMetric?.metric_value).toBe(1);
    // jsdocCount for the one documented function should be 1.
    expect(byKey.get('documentation.jsdocCount')?.metric_value).toBe(1);
    // No deprecated tags in this fixture.
    expect(byKey.get('documentation.deprecatedCount')?.metric_value).toBe(0);
  });

  it('emits an entityStats patch setting has_jsdoc=true for the documented function', async () => {
    expect(project).not.toBeNull();
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', fixturePath));
    const ctx = makeContext(parseResult, project);

    const result = await new DocumentationAnalyzer().run(ctx);
    const patches = result.entityStats ?? [];

    expect(patches.length).toBeGreaterThanOrEqual(1);
    const fnPatch = patches.find((p) => p.entity_type === 'function');
    expect(fnPatch).toBeDefined();
    expect(fnPatch?.columns['has_jsdoc']).toBe(true);
  });
});
