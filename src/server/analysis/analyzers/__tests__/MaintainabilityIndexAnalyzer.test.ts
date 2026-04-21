import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConsola } from 'consola';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';
import { MaintainabilityIndexAnalyzer } from '../MaintainabilityIndexAnalyzer';
import { createDefaultConfig } from '../../types';
import { generateEntityMetricUUID } from '../../../utils/uuid';

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

function makeModule(id: string, directory: string, filename: string): IModuleCreateDTO {
  return {
    id,
    package_id: 'pkg-test',
    name: id,
    source: {
      directory,
      name: id,
      filename,
      relativePath: filename,
    },
  };
}

function makeContext(parseResult: ParseResult): AnalyzerContext {
  return {
    parseResult,
    project: null,
    packageRoot: '/tmp',
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: createDefaultConfig(),
    logger: createConsola({ level: 0 }),
  };
}

describe('MaintainabilityIndexAnalyzer', () => {
  let tmpDir: string;
  let fixturePath: string;

  // A modest TypeScript fixture with decision points and enough tokens to
  // produce a non-trivial Halstead volume.
  const fixtureSource = [
    '// A small sample module',
    'export function greet(name: string): string {',
    '  if (name.length === 0) {',
    '    return "anonymous";',
    '  }',
    '  const parts = name.split(" ");',
    '  return parts.map((p) => p.trim()).join(" ");',
    '}',
    '',
    'export function safeDivide(a: number, b: number): number {',
    '  return b === 0 ? 0 : a / b;',
    '}',
    '',
  ].join('\n');

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'maintainability-analyzer-test-'));
    fixturePath = join(tmpDir, 'fixture.ts');
    await writeFile(fixturePath, fixtureSource, 'utf-8');
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has the expected static metadata', () => {
    const analyzer = new MaintainabilityIndexAnalyzer();
    expect(analyzer.id).toBe('maintainability');
    expect(analyzer.category).toBe('composite');
    expect(analyzer.requires).toEqual([]);
    expect(analyzer.dependsOn).toEqual(['size', 'complexity']);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('emits a maintainability index metric in the [0, 100] range', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', tmpDir, fixturePath));
    const ctx = makeContext(parseResult);

    const result = await new MaintainabilityIndexAnalyzer().run(ctx);

    expect(result.metrics).toBeDefined();
    expect(result.metrics).toHaveLength(1);

    const metric = result.metrics?.[0];
    expect(metric).toBeDefined();
    expect(metric?.metric_key).toBe('composite.maintainabilityIndex');
    expect(metric?.metric_category).toBe('composite');
    expect(metric?.entity_type).toBe('module');
    expect(metric?.entity_id).toBe('mod-1');
    expect(metric?.module_id).toBe('mod-1');
    expect(metric?.package_id).toBe('pkg-test');
    expect(metric?.snapshot_id).toBe('snap-test');
    expect(metric?.id).toBe(
      generateEntityMetricUUID('snap-test', 'mod-1', 'module', 'composite.maintainabilityIndex')
    );

    const value = metric?.metric_value ?? Number.NaN;
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('skips unreadable module files silently', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(
      makeModule('mod-missing', tmpDir, join(tmpDir, 'does-not-exist.ts'))
    );
    const ctx = makeContext(parseResult);

    const result = await new MaintainabilityIndexAnalyzer().run(ctx);

    expect(result.metrics ?? []).toHaveLength(0);
  });

  it('still emits a value (>= 0) for an empty source file', async () => {
    const parseResult = makeEmptyParseResult();
    const emptyPath = join(tmpDir, 'empty.ts');
    await writeFile(emptyPath, '', 'utf-8');
    parseResult.modules.push(makeModule('mod-empty', tmpDir, emptyPath));
    const ctx = makeContext(parseResult);

    const result = await new MaintainabilityIndexAnalyzer().run(ctx);

    expect(result.metrics).toHaveLength(1);
    const metric = result.metrics?.[0];
    const value = metric?.metric_value ?? Number.NaN;
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });
});
