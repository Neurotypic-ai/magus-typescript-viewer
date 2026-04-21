import { createConsola } from 'consola';
import { describe, expect, it } from 'vitest';

import type { Import } from '../../../../shared/types/Import';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';
import { CouplingAnalyzer } from '../CouplingAnalyzer';
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

function makeImport(relativePath: string): Import {
  // Match the runtime shape of a parsed Import: uuid, fullPath, relativePath,
  // name, specifiers, depth. The analyzer only reads `relativePath`.
  return {
    uuid: `imp-${relativePath}`,
    fullPath: relativePath,
    relativePath,
    name: relativePath,
    specifiers: new Map(),
    depth: 0,
  } as unknown as Import;
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

describe('CouplingAnalyzer', () => {
  it('has the expected static metadata', () => {
    const analyzer = new CouplingAnalyzer();
    expect(analyzer.id).toBe('coupling');
    expect(analyzer.category).toBe('coupling');
    expect(analyzer.requires).toEqual([]);
    expect(analyzer.dependsOn).toEqual(['size']);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('computes afferent / efferent / instability for a linear A -> B -> C chain', async () => {
    const dir = '/tmp/pkg';
    const parseResult = makeEmptyParseResult();

    const modA = makeModule('mod-a', dir, `${dir}/A.ts`);
    const modB = makeModule('mod-b', dir, `${dir}/B.ts`);
    const modC = makeModule('mod-c', dir, `${dir}/C.ts`);

    parseResult.modules.push(modA, modB, modC);

    // A imports B, B imports C. External imports should be ignored.
    parseResult.importsWithModules = [
      { import: makeImport('./B'), moduleId: modA.id },
      { import: makeImport('./C'), moduleId: modB.id },
      { import: makeImport('react'), moduleId: modA.id },
    ];

    const ctx = makeContext(parseResult);
    const result = await new CouplingAnalyzer().run(ctx);

    expect(result.metrics).toBeDefined();
    // 3 modules x 3 metrics each = 9 rows
    expect(result.metrics).toHaveLength(9);

    type Metric = NonNullable<typeof result.metrics>[number];
    const byEntityAndKey = new Map<string, Metric>();
    for (const metric of result.metrics ?? []) {
      byEntityAndKey.set(`${metric.entity_id}::${metric.metric_key}`, metric);
    }

    const getValue = (entityId: string, key: string): number => {
      const row = byEntityAndKey.get(`${entityId}::${key}`);
      if (!row) throw new Error(`missing metric ${entityId}:${key}`);
      return row.metric_value;
    };

    // A: imports B, no one imports A.
    expect(getValue('mod-a', 'coupling.efferent')).toBe(1);
    expect(getValue('mod-a', 'coupling.afferent')).toBe(0);
    expect(getValue('mod-a', 'coupling.instability')).toBe(1);

    // B: imports C, is imported by A. Ce=1, Ca=1, I=0.5.
    expect(getValue('mod-b', 'coupling.efferent')).toBe(1);
    expect(getValue('mod-b', 'coupling.afferent')).toBe(1);
    expect(getValue('mod-b', 'coupling.instability')).toBeCloseTo(0.5, 10);

    // C: imports nothing, is imported by B.
    expect(getValue('mod-c', 'coupling.efferent')).toBe(0);
    expect(getValue('mod-c', 'coupling.afferent')).toBe(1);
    expect(getValue('mod-c', 'coupling.instability')).toBe(0);

    // All rows target modules, share snapshot/package, and use canonical UUIDs.
    for (const metric of result.metrics ?? []) {
      expect(metric.entity_type).toBe('module');
      expect(metric.metric_category).toBe('coupling');
      expect(metric.package_id).toBe('pkg-test');
      expect(metric.snapshot_id).toBe('snap-test');
      expect(metric.module_id).toBe(metric.entity_id);
      expect(metric.id).toBe(
        generateEntityMetricUUID('snap-test', metric.entity_id, 'module', metric.metric_key)
      );
    }
  });

  it('emits zero-valued metrics for modules with no imports or importers', async () => {
    const dir = '/tmp/pkg';
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-lonely', dir, `${dir}/Lonely.ts`));
    parseResult.importsWithModules = [];

    const ctx = makeContext(parseResult);
    const result = await new CouplingAnalyzer().run(ctx);

    expect(result.metrics).toHaveLength(3);
    for (const metric of result.metrics ?? []) {
      if (metric.metric_key === 'coupling.instability') {
        expect(metric.metric_value).toBe(0);
      } else {
        expect(metric.metric_value).toBe(0);
      }
    }
  });

  it('ignores self-imports and non-relative specifiers', async () => {
    const dir = '/tmp/pkg';
    const parseResult = makeEmptyParseResult();
    const modSelf = makeModule('mod-self', dir, `${dir}/Self.ts`);
    parseResult.modules.push(modSelf);
    parseResult.importsWithModules = [
      { import: makeImport('./Self'), moduleId: modSelf.id },
      { import: makeImport('vue'), moduleId: modSelf.id },
      { import: makeImport('@scoped/pkg'), moduleId: modSelf.id },
    ];

    const ctx = makeContext(parseResult);
    const result = await new CouplingAnalyzer().run(ctx);

    expect(result.metrics).toHaveLength(3);
    type Metric = NonNullable<typeof result.metrics>[number];
    const byKey = new Map<string, Metric>(
      (result.metrics ?? []).map((row) => [row.metric_key, row])
    );
    expect(byKey.get('coupling.efferent')?.metric_value).toBe(0);
    expect(byKey.get('coupling.afferent')?.metric_value).toBe(0);
    expect(byKey.get('coupling.instability')?.metric_value).toBe(0);
  });
});
