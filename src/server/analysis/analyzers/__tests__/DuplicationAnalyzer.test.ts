import { EventEmitter } from 'node:events';

import { createConsola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';
import { createDefaultConfig } from '../../types';

// Hoisted mocks so they're visible before the analyzer module is evaluated.
const { spawnMock, readFileMock, mkdtempMock, rmMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  readFileMock: vi.fn(),
  mkdtempMock: vi.fn(),
  rmMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  rm: rmMock,
}));

// Helpers
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

function makeModule(id: string, filename: string, name = 'fixture'): IModuleCreateDTO {
  return {
    id,
    package_id: 'pkg-test',
    name,
    source: {
      directory: '/tmp',
      name,
      filename,
      relativePath: name,
    },
  };
}

function makeContext(parseResult: ParseResult): AnalyzerContext {
  return {
    parseResult,
    project: null,
    packageRoot: '/fake/pkg',
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: createDefaultConfig(),
    logger: createConsola({ level: 0 }),
  };
}

/**
 * Stub ChildProcess: synchronously emits `close` with the supplied exit code
 * after the caller attaches its listeners. We schedule via `queueMicrotask`
 * so the event fires *after* the promise executor finishes attaching handlers.
 */
function makeFakeChild(exitCode = 0): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  queueMicrotask(() => {
    child.emit('close', exitCode);
  });

  return child;
}

describe('DuplicationAnalyzer', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    readFileMock.mockReset();
    mkdtempMock.mockReset();
    rmMock.mockReset();

    mkdtempMock.mockResolvedValue('/tmp/jscpd-abc');
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the expected static metadata', async () => {
    const { DuplicationAnalyzer } = await import('../DuplicationAnalyzer');
    const analyzer = new DuplicationAnalyzer();
    expect(analyzer.id).toBe('duplication');
    expect(analyzer.category).toBe('duplication');
    expect(analyzer.requires).toEqual(['subprocess']);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('emits one 2-fragment cluster per jscpd duplicate pair', async () => {
    const { DuplicationAnalyzer } = await import('../DuplicationAnalyzer');

    spawnMock.mockImplementation(() => makeFakeChild(0));

    const syntheticReport = {
      duplicates: [
        {
          format: 'typescript',
          lines: 12,
          tokens: 85,
          fragment: 'const a = 1;\nconst b = 2;',
          firstFile: {
            name: '/fake/pkg/src/alpha.ts',
            startLoc: { line: 10 },
            endLoc: { line: 22 },
          },
          secondFile: {
            name: '/fake/pkg/src/beta.ts',
            startLoc: { line: 40 },
            endLoc: { line: 52 },
          },
        },
        {
          format: 'typescript',
          lines: 20,
          tokens: 140,
          fragment: 'function share() {}\nfunction share2() {}',
          firstFile: {
            name: '/fake/pkg/src/alpha.ts',
            startLoc: { line: 100 },
            endLoc: { line: 120 },
          },
          secondFile: {
            name: '/fake/pkg/src/gamma.ts',
            startLoc: { line: 5 },
            endLoc: { line: 25 },
          },
        },
      ],
    };
    readFileMock.mockResolvedValue(JSON.stringify(syntheticReport));

    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(
      makeModule('mod-alpha', '/fake/pkg/src/alpha.ts', 'alpha'),
      makeModule('mod-beta', '/fake/pkg/src/beta.ts', 'beta'),
      makeModule('mod-gamma', '/fake/pkg/src/gamma.ts', 'gamma')
    );
    const ctx = makeContext(parseResult);

    const result = await new DuplicationAnalyzer().run(ctx);

    // Cluster count == duplicate pair count (2)
    expect(result.duplications).toBeDefined();
    expect(result.duplications).toHaveLength(2);

    // Each cluster has fragment_count == 2
    for (const cluster of result.duplications ?? []) {
      expect(cluster.fragment_count).toBe(2);
      expect(cluster.package_id).toBe('pkg-test');
      const fragments: unknown = JSON.parse(cluster.fragments_json);
      expect(Array.isArray(fragments)).toBe(true);
      expect((fragments as unknown[]).length).toBe(2);
    }

    // Token/line counts copied from the report
    const first = result.duplications?.[0];
    expect(first?.token_count).toBe(85);
    expect(first?.line_count).toBe(12);

    // Per-module duplication line metrics are emitted.
    expect(result.metrics).toBeDefined();
    const byModule = new Map(
      (result.metrics ?? []).map((m) => [m.module_id, m.metric_value])
    );
    // alpha participates in both pairs -> 12 + 20 = 32
    expect(byModule.get('mod-alpha')).toBe(32);
    // beta in first pair only -> 12
    expect(byModule.get('mod-beta')).toBe(12);
    // gamma in second pair only -> 20
    expect(byModule.get('mod-gamma')).toBe(20);

    for (const metric of result.metrics ?? []) {
      expect(metric.metric_key).toBe('duplication.duplicatedLineCount');
      expect(metric.metric_category).toBe('duplication');
      expect(metric.entity_type).toBe('module');
      expect(metric.snapshot_id).toBe('snap-test');
      expect(metric.package_id).toBe('pkg-test');
    }

    // Temp dir was cleaned up
    expect(rmMock).toHaveBeenCalledWith(
      '/tmp/jscpd-abc',
      expect.objectContaining({ recursive: true, force: true })
    );
  });

  it('returns empty result and still cleans up when jscpd spawn errors (not installed)', async () => {
    const { DuplicationAnalyzer } = await import('../DuplicationAnalyzer');

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.emit('error', new Error('ENOENT: jscpd not installed'));
      });
      return child;
    });

    const ctx = makeContext(makeEmptyParseResult());
    const result = await new DuplicationAnalyzer().run(ctx);

    expect(result.duplications ?? []).toHaveLength(0);
    expect(result.metrics ?? []).toHaveLength(0);
    expect(rmMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty result when jscpd produced no report file', async () => {
    const { DuplicationAnalyzer } = await import('../DuplicationAnalyzer');

    spawnMock.mockImplementation(() => makeFakeChild(0));
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const ctx = makeContext(makeEmptyParseResult());
    const result = await new DuplicationAnalyzer().run(ctx);

    expect(result.duplications ?? []).toHaveLength(0);
    expect(result.metrics ?? []).toHaveLength(0);
  });
});
