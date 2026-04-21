import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConsola } from 'consola';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ParseResult } from '../../../parsers/ParseResult';
import type { IFunctionCreateDTO } from '../../../../shared/types/dto/FunctionDTO';
import type { IMethodCreateDTO } from '../../../../shared/types/dto/MethodDTO';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { AnalyzerContext } from '../../types';
import { SizeAnalyzer } from '../SizeAnalyzer';
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

describe('SizeAnalyzer', () => {
  let tmpDir: string;
  let fixturePath: string;

  // A fixture designed so counts are stable and easy to reason about:
  //   Line  1: "// line comment"            -> comment
  //   Line  2: ""                            -> blank
  //   Line  3: "const x = 1;"                -> code
  //   Line  4: "/* block start"              -> comment
  //   Line  5: "   still block */"           -> comment
  //   Line  6: ""                            -> blank
  //   Line  7: "function foo() {"            -> code
  //   Line  8: "  return x + 1;"             -> code
  //   Line  9: "}"                            -> code
  //   Line 10: ""                            -> blank
  // physical=10, logical=4 (code lines), blank=3, comment=3
  const fixtureSource = [
    '// line comment',
    '',
    'const x = 1;',
    '/* block start',
    '   still block */',
    '',
    'function foo() {',
    '  return x + 1;',
    '}',
    '',
  ].join('\n');

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'size-analyzer-test-'));
    fixturePath = join(tmpDir, 'fixture.ts');
    await writeFile(fixturePath, fixtureSource, 'utf-8');
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has the expected static metadata', () => {
    const analyzer = new SizeAnalyzer();
    expect(analyzer.id).toBe('size');
    expect(analyzer.category).toBe('size');
    expect(analyzer.requires).toEqual([]);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('computes module-level size counts from a fixture file', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', fixturePath));
    const ctx = makeContext(parseResult);

    const result = await new SizeAnalyzer().run(ctx);

    // ModuleStatsPatch assertion
    expect(result.moduleStats).toBeDefined();
    expect(result.moduleStats).toHaveLength(1);
    const patch = result.moduleStats?.[0];
    expect(patch?.module_id).toBe('mod-1');
    expect(patch?.columns['physical_lines']).toBe(10);
    expect(patch?.columns['logical_lines']).toBe(4);
    expect(patch?.columns['comment_lines']).toBe(3);
    // Blank lines aren't persisted as a column but we can verify the identity:
    // physical = logical + comment + blank  => blank = 10 - 4 - 3 = 3
    const physical = patch?.columns['physical_lines'] as number;
    const logical = patch?.columns['logical_lines'] as number;
    const comment = patch?.columns['comment_lines'] as number;
    expect(physical - logical - comment).toBe(3);
    // Halstead volume should be a finite positive number for non-trivial code.
    const halstead = patch?.columns['halstead_volume'] as number;
    expect(Number.isFinite(halstead)).toBe(true);
    expect(halstead).toBeGreaterThan(0);

    // Metrics: exactly 4 per module (physical, logical, comment, halstead)
    expect(result.metrics).toBeDefined();
    expect(result.metrics).toHaveLength(4);
    const byKey = new Map(result.metrics?.map((m) => [m.metric_key, m]));
    expect(byKey.get('size.physicalLines')?.metric_value).toBe(10);
    expect(byKey.get('size.logicalLines')?.metric_value).toBe(4);
    expect(byKey.get('size.commentLines')?.metric_value).toBe(3);
    expect(byKey.get('size.halsteadVolume')?.metric_value).toBeGreaterThan(0);

    // All metric rows should target the module, share snapshot/package, and
    // use the canonical UUID helper.
    for (const metric of result.metrics ?? []) {
      expect(metric.entity_type).toBe('module');
      expect(metric.entity_id).toBe('mod-1');
      expect(metric.module_id).toBe('mod-1');
      expect(metric.package_id).toBe('pkg-test');
      expect(metric.snapshot_id).toBe('snap-test');
      expect(metric.metric_category).toBe('size');
      expect(metric.id).toBe(
        generateEntityMetricUUID('snap-test', 'mod-1', 'module', metric.metric_key)
      );
    }

    // No methods/functions in this parse result => no entityStats
    expect(result.entityStats ?? []).toHaveLength(0);
  });

  it('skips unreadable module files silently', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-missing', join(tmpDir, 'does-not-exist.ts')));
    const ctx = makeContext(parseResult);

    const result = await new SizeAnalyzer().run(ctx);

    expect(result.moduleStats ?? []).toHaveLength(0);
    expect(result.metrics ?? []).toHaveLength(0);
  });

  it('emits per-method and per-function logical_lines when start/end are present', async () => {
    const parseResult = makeEmptyParseResult();

    const method: IMethodCreateDTO = {
      id: 'method-1',
      package_id: 'pkg-test',
      module_id: 'mod-1',
      parent_id: 'class-1',
      parent_type: 'class',
      name: 'doThing',
      return_type: 'void',
      is_static: false,
      is_async: false,
      visibility: 'public',
      start_line: 10,
      end_line: 24,
    };
    parseResult.methods.push(method);

    const fn: IFunctionCreateDTO = {
      id: 'fn-1',
      package_id: 'pkg-test',
      module_id: 'mod-1',
      name: 'helper',
      start_line: 30,
      end_line: 32,
    };
    parseResult.functions.push(fn);

    // A function without start/end should be skipped.
    parseResult.functions.push({
      id: 'fn-no-lines',
      package_id: 'pkg-test',
      module_id: 'mod-1',
      name: 'mystery',
    });

    const ctx = makeContext(parseResult);
    const result = await new SizeAnalyzer().run(ctx);

    const entityStats = result.entityStats ?? [];
    expect(entityStats).toHaveLength(2);
    const methodPatch = entityStats.find((p) => p.entity_id === 'method-1');
    const fnPatch = entityStats.find((p) => p.entity_id === 'fn-1');
    expect(methodPatch?.entity_type).toBe('method');
    expect(methodPatch?.columns['logical_lines']).toBe(15); // 24 - 10 + 1
    expect(fnPatch?.entity_type).toBe('function');
    expect(fnPatch?.columns['logical_lines']).toBe(3); // 32 - 30 + 1

    const metrics = result.metrics ?? [];
    expect(metrics).toHaveLength(2);
    const methodMetric = metrics.find((m) => m.entity_id === 'method-1');
    const fnMetric = metrics.find((m) => m.entity_id === 'fn-1');
    expect(methodMetric?.metric_key).toBe('size.logicalLines');
    expect(methodMetric?.metric_value).toBe(15);
    expect(methodMetric?.metric_category).toBe('size');
    expect(fnMetric?.metric_key).toBe('size.logicalLines');
    expect(fnMetric?.metric_value).toBe(3);
  });
});
