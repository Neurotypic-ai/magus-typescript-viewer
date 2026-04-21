import { EventEmitter } from 'node:events';

import { createConsola } from 'consola';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KnipAnalyzer } from '../KnipAnalyzer';
import { createDefaultConfig } from '../../types';
import {
  generateCodeIssueUUID,
  generateEntityMetricUUID,
} from '../../../utils/uuid';

import type { ChildProcess } from 'node:child_process';
import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
import type { ParseResult } from '../../../parsers/ParseResult';
import type { AnalyzerContext } from '../../types';

// ── Mock node:child_process ──────────────────────────────────────────────────
// The analyzer calls `spawn('pnpm', ['knip', ...])` and reads stdout lines until
// 'close' fires. We simulate that lifecycle with fakes that tests populate via
// `setFakeSpawnResponse` before invoking the analyzer.

interface FakeSpawnResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  emitError?: Error;
}

let fakeResponse: FakeSpawnResponse = { stdout: '', stderr: '', exitCode: 0 };

function setFakeSpawnResponse(next: FakeSpawnResponse): void {
  fakeResponse = next;
}

vi.mock('node:child_process', async () => {
  return {
    spawn: vi.fn((): ChildProcess => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;

      (child as unknown as { stdout: EventEmitter }).stdout = stdout;
      (child as unknown as { stderr: EventEmitter }).stderr = stderr;
      (child as unknown as { kill: (signal?: string) => boolean }).kill = () => true;

      // Emit asynchronously so the caller has a chance to attach listeners.
      setImmediate(() => {
        if (fakeResponse.emitError) {
          child.emit('error', fakeResponse.emitError);
          return;
        }
        if (fakeResponse.stdout) {
          stdout.emit('data', Buffer.from(fakeResponse.stdout, 'utf8'));
        }
        if (fakeResponse.stderr) {
          stderr.emit('data', Buffer.from(fakeResponse.stderr, 'utf8'));
        }
        child.emit('close', fakeResponse.exitCode);
      });

      return child as unknown as ChildProcess;
    }),
  };
});

// ── Fixture builders ─────────────────────────────────────────────────────────

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

function makeModule(id: string, relativePath: string, packageRoot: string): IModuleCreateDTO {
  return {
    id,
    package_id: 'pkg-test',
    name: relativePath,
    source: {
      directory: packageRoot,
      name: relativePath.replace(/\.tsx?$/, ''),
      filename: `${packageRoot}/${relativePath}`,
      relativePath,
    },
  };
}

function makeContext(parseResult: ParseResult, packageRoot = '/fake/root'): AnalyzerContext {
  return {
    parseResult,
    project: null,
    packageRoot,
    packageId: 'pkg-test',
    snapshotId: 'snap-test',
    repositories: {},
    config: createDefaultConfig(),
    logger: createConsola({ level: 0 }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KnipAnalyzer', () => {
  beforeEach(() => {
    setFakeSpawnResponse({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('has the expected static metadata', () => {
    const analyzer = new KnipAnalyzer();
    expect(analyzer.id).toBe('knip');
    expect(analyzer.category).toBe('deadCode');
    expect(analyzer.requires).toEqual(['subprocess']);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('respects config.disabledAnalyzers', () => {
    const analyzer = new KnipAnalyzer();
    const cfg = createDefaultConfig();
    cfg.disabledAnalyzers = ['knip'];
    expect(analyzer.enabled(cfg)).toBe(false);
  });

  it('respects an explicit enabledAnalyzers allowlist', () => {
    const analyzer = new KnipAnalyzer();
    const cfg = createDefaultConfig();
    cfg.enabledAnalyzers = ['other'];
    expect(analyzer.enabled(cfg)).toBe(false);
  });

  it('converts a knip JSON report into findings + metrics for matched modules', async () => {
    const packageRoot = '/fake/root';
    const parseResult = makeEmptyParseResult();
    // Module A: two unused exports + whole-file unused.
    parseResult.modules.push(makeModule('mod-a', 'src/a.ts', packageRoot));
    // Module B: one unused type only (severity=info), not dead.
    parseResult.modules.push(makeModule('mod-b', 'src/b.ts', packageRoot));

    const report = {
      issues: [
        {
          file: 'src/a.ts',
          exports: [
            { name: 'foo', line: 10, col: 3 },
            { name: 'bar', line: 20, col: 5 },
          ],
          types: [],
          files: [{ name: 'src/a.ts' }],
        },
        {
          file: 'src/b.ts',
          exports: [],
          types: [{ name: 'SomeType', line: 7, col: 1 }],
          files: [],
        },
        {
          // Config file knip mentions that isn't in our parseResult — should be skipped.
          file: 'not-parsed.config.ts',
          exports: [{ name: 'ignored', line: 1, col: 1 }],
        },
      ],
    };

    setFakeSpawnResponse({
      stdout: JSON.stringify(report),
      stderr: '',
      exitCode: 1, // knip returns non-zero when it finds issues
    });

    const analyzer = new KnipAnalyzer();
    const result = await analyzer.run(makeContext(parseResult, packageRoot));

    const findings = result.findings ?? [];
    // mod-a: 2 unusedExport + 1 unusedFile. mod-b: 1 unusedType. not-parsed: skipped.
    expect(findings).toHaveLength(4);

    const aFindings = findings.filter((f) => f.module_id === 'mod-a');
    const bFindings = findings.filter((f) => f.module_id === 'mod-b');
    expect(aFindings).toHaveLength(3);
    expect(bFindings).toHaveLength(1);

    const aExport = aFindings.find((f) => f.rule_code === 'knip.unusedExport' && f.entity_name === 'foo');
    expect(aExport).toBeDefined();
    expect(aExport?.severity).toBe('warning');
    expect(aExport?.file_path).toBe('src/a.ts');
    expect(aExport?.line).toBe(10);
    expect(aExport?.column).toBe(3);
    expect(aExport?.package_id).toBe('pkg-test');
    expect(aExport?.id).toBe(
      generateCodeIssueUUID('mod-a', 'knip.unusedExport', 'src/a.ts:10:foo')
    );

    const deadFileFinding = aFindings.find((f) => f.rule_code === 'knip.unusedFile');
    expect(deadFileFinding).toBeDefined();
    expect(deadFileFinding?.severity).toBe('warning');

    const typeFinding = bFindings[0];
    expect(typeFinding).toBeDefined();
    expect(typeFinding?.rule_code).toBe('knip.unusedType');
    expect(typeFinding?.severity).toBe('info');
    expect(typeFinding?.entity_name).toBe('SomeType');

    // Metrics: two modules touched, two metrics per module.
    const metrics = result.metrics ?? [];
    expect(metrics).toHaveLength(4);

    const metricsByModule = new Map<string, Map<string, number>>();
    for (const m of metrics) {
      const bucket = metricsByModule.get(m.entity_id) ?? new Map<string, number>();
      bucket.set(m.metric_key, m.metric_value);
      metricsByModule.set(m.entity_id, bucket);
      expect(m.entity_type).toBe('module');
      expect(m.metric_category).toBe('deadCode');
      expect(m.snapshot_id).toBe('snap-test');
      expect(m.package_id).toBe('pkg-test');
      expect(m.id).toBe(generateEntityMetricUUID('snap-test', m.entity_id, 'module', m.metric_key));
    }

    const aMetrics = metricsByModule.get('mod-a');
    expect(aMetrics?.get('deadCode.unusedExportCount')).toBe(2);
    expect(aMetrics?.get('deadCode.isDead')).toBe(1);

    const bMetrics = metricsByModule.get('mod-b');
    // Only unused types reported (types count toward the unused-export metric too).
    expect(bMetrics?.get('deadCode.unusedExportCount')).toBe(1);
    expect(bMetrics?.get('deadCode.isDead')).toBe(0);
  });

  it('returns an empty result when stdout contains no JSON', async () => {
    const packageRoot = '/fake/root';
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-a', 'src/a.ts', packageRoot));

    setFakeSpawnResponse({ stdout: 'no json here', stderr: 'oops', exitCode: 2 });

    const analyzer = new KnipAnalyzer();
    const result = await analyzer.run(makeContext(parseResult, packageRoot));

    expect(result.findings ?? []).toHaveLength(0);
    expect(result.metrics ?? []).toHaveLength(0);
  });

  it('tolerates a pnpm banner preceding the JSON blob', async () => {
    const packageRoot = '/fake/root';
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-a', 'src/a.ts', packageRoot));

    const pnpmBanner = '> pkg@1.0.0 knip /fake/root\n> knip --reporter json\n\n';
    const report = { issues: [{ file: 'src/a.ts', exports: [{ name: 'foo', line: 1, col: 1 }] }] };
    setFakeSpawnResponse({
      stdout: pnpmBanner + JSON.stringify(report),
      stderr: '',
      exitCode: 1,
    });

    const result = await new KnipAnalyzer().run(makeContext(parseResult, packageRoot));
    expect(result.findings).toHaveLength(1);
    expect(result.findings?.[0]?.rule_code).toBe('knip.unusedExport');
  });

  it('returns empty result on spawn error without throwing', async () => {
    const packageRoot = '/fake/root';
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-a', 'src/a.ts', packageRoot));

    setFakeSpawnResponse({
      stdout: '',
      stderr: '',
      exitCode: 0,
      emitError: new Error('spawn ENOENT'),
    });

    const result = await new KnipAnalyzer().run(makeContext(parseResult, packageRoot));
    expect(result.findings ?? []).toHaveLength(0);
    expect(result.metrics ?? []).toHaveLength(0);
  });
});
