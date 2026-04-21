import { createConsola } from 'consola';
import { describe, expect, it, vi } from 'vitest';

import { DependencyCruiserAnalyzer } from '../DependencyCruiserAnalyzer';
import { createDefaultConfig } from '../../types';
import {
  generateArchitecturalViolationUUID,
  generateDependencyCycleUUID,
} from '../../../utils/uuid';

import type { ParseResult } from '../../../parsers/ParseResult';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { AnalyzerContext } from '../../types';
import type { DepCruiserRunner } from '../DependencyCruiserAnalyzer';

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

function makeModule(id: string, relativePath: string): IModuleCreateDTO {
  return {
    id,
    package_id: 'pkg-test',
    name: id,
    source: {
      directory: '/pkg',
      name: id,
      filename: `/pkg/${relativePath}`,
      relativePath,
    },
  };
}

function makeContext(parseResult: ParseResult): AnalyzerContext {
  return {
    parseResult,
    project: null,
    packageRoot: '/pkg',
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: createDefaultConfig(),
    logger: createConsola({ level: 0 }),
  };
}

/** Build a dep-cruiser JSON payload the analyzer knows how to parse. */
function makeDepCruiserJSON(): string {
  return JSON.stringify({
    summary: {
      violations: [
        {
          type: 'cycle',
          from: 'src/server/a.ts',
          to: 'src/server/b.ts',
          cycle: ['src/server/a.ts', 'src/server/b.ts'],
          rule: { name: 'no-circular', severity: 'warn', comment: 'No cycles' },
        },
        {
          type: 'error',
          from: 'src/server/entry.ts',
          to: 'src/client/widget.ts',
          rule: {
            name: 'no-server-to-client',
            severity: 'error',
            comment: 'server layer must not depend on client layer.',
          },
        },
      ],
    },
  });
}

describe('DependencyCruiserAnalyzer', () => {
  it('has the expected static metadata', () => {
    const analyzer = new DependencyCruiserAnalyzer();
    expect(analyzer.id).toBe('dep-cruiser');
    expect(analyzer.category).toBe('architecture');
    expect(analyzer.requires).toEqual(['subprocess']);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('emits one cycle DTO and one architectural violation DTO from dep-cruiser output', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-a', 'src/server/a.ts'));
    parseResult.modules.push(makeModule('mod-b', 'src/server/b.ts'));
    parseResult.modules.push(makeModule('mod-entry', 'src/server/entry.ts'));
    parseResult.modules.push(makeModule('mod-widget', 'src/client/widget.ts'));

    const runner: DepCruiserRunner = vi.fn().mockResolvedValue({
      stdout: makeDepCruiserJSON(),
      stderr: '',
      exitCode: 1, // dep-cruiser exits non-zero when violations are found
    });

    const analyzer = new DependencyCruiserAnalyzer(runner);
    const ctx = makeContext(parseResult);
    const result = await analyzer.run(ctx);

    // Runner was called with the expected shape.
    expect(runner).toHaveBeenCalledTimes(1);
    const runnerCall = (runner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(runnerCall).toBeDefined();
    const callArg = runnerCall?.[0] as { configPath: string; cwd: string; target: string };
    expect(callArg.cwd).toBe('/pkg');
    expect(callArg.target).toBe('src');
    expect(callArg.configPath).toMatch(/dep-cruiser-.*\.cjs$/);

    // Exactly one cycle.
    expect(result.cycles).toBeDefined();
    expect(result.cycles).toHaveLength(1);
    const cycle = result.cycles?.[0];
    expect(cycle?.package_id).toBe('pkg-test');
    expect(cycle?.length).toBe(2);
    expect(cycle?.severity).toBe('warning');
    expect(cycle?.id).toBe(
      generateDependencyCycleUUID('pkg-test', 'src/server/a.ts->src/server/b.ts')
    );
    const participants = JSON.parse(cycle?.participants_json ?? '[]') as string[];
    expect(participants).toEqual(['mod-a', 'mod-b']);

    // Exactly one architectural violation.
    expect(result.architecturalViolations).toBeDefined();
    expect(result.architecturalViolations).toHaveLength(1);
    const violation = result.architecturalViolations?.[0];
    expect(violation?.rule_name).toBe('no-server-to-client');
    expect(violation?.severity).toBe('error');
    expect(violation?.source_module_id).toBe('mod-entry');
    expect(violation?.target_module_id).toBe('mod-widget');
    expect(violation?.source_layer).toBe('server');
    expect(violation?.target_layer).toBe('client');
    expect(violation?.message).toBe('server layer must not depend on client layer.');
    expect(violation?.id).toBe(
      generateArchitecturalViolationUUID(
        'snap-test',
        'no-server-to-client',
        'mod-entry',
        'mod-widget'
      )
    );
  });

  it('returns an empty result gracefully when the depcruise binary is missing', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-a', 'src/server/a.ts'));

    const runner: DepCruiserRunner = vi.fn().mockRejectedValue(
      Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' })
    );

    const analyzer = new DependencyCruiserAnalyzer(runner);
    const result = await analyzer.run(makeContext(parseResult));

    expect(result.cycles ?? []).toHaveLength(0);
    expect(result.architecturalViolations ?? []).toHaveLength(0);
  });

  it('filters out cycles whose paths cannot be mapped to modules', async () => {
    const parseResult = makeEmptyParseResult();
    // No modules match the reported cycle paths.
    parseResult.modules.push(makeModule('mod-unrelated', 'src/shared/other.ts'));

    const runner: DepCruiserRunner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        summary: {
          violations: [
            {
              type: 'cycle',
              cycle: ['src/server/a.ts', 'src/server/b.ts'],
              rule: { name: 'no-circular', severity: 'warn' },
            },
          ],
        },
      }),
      stderr: '',
      exitCode: 1,
    });

    const analyzer = new DependencyCruiserAnalyzer(runner);
    const result = await analyzer.run(makeContext(parseResult));

    expect(result.cycles ?? []).toHaveLength(0);
    expect(result.architecturalViolations ?? []).toHaveLength(0);
  });
});
