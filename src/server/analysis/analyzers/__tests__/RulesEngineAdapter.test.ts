import { createConsola } from 'consola';
import { describe, expect, it } from 'vitest';

import { RulesEngine } from '../../../rules/RulesEngine';
import { RulesEngineAdapter } from '../RulesEngineAdapter';
import { createDefaultConfig } from '../../types';

import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';

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

describe('RulesEngineAdapter', () => {
  it('has the expected static metadata', () => {
    const adapter = new RulesEngineAdapter(new RulesEngine([]));
    expect(adapter.id).toBe('legacy-rules');
    expect(adapter.category).toBe('quality');
    expect(adapter.requires).toEqual([]);
    expect(adapter.enabled(createDefaultConfig())).toBe(true);
  });

  it('returns an empty findings array for an empty ParseResult with no rules', async () => {
    const adapter = new RulesEngineAdapter(new RulesEngine([]));
    const ctx = makeContext(makeEmptyParseResult());

    const result = await adapter.run(ctx);

    expect(result.findings).toBeDefined();
    expect(result.findings).toEqual([]);
  });

  it('does not throw when run against an empty ParseResult', async () => {
    const adapter = new RulesEngineAdapter(new RulesEngine([]));
    const ctx = makeContext(makeEmptyParseResult());

    await expect(adapter.run(ctx)).resolves.toBeDefined();
  });
});
