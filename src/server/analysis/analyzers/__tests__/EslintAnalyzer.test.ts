/**
 * EslintAnalyzer integration test.
 *
 * This test actually runs ESLint against a temp fixture file, so it depends
 * on `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`,
 * `eslint-plugin-sonarjs`, and `eslint-plugin-unicorn` being installed. If
 * any plugin cannot be loaded the analyzer should return an empty finding
 * set — in that case we skip the content assertions and only verify the
 * no-crash contract.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConsola } from 'consola';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EslintAnalyzer } from '../EslintAnalyzer';
import { createDefaultConfig } from '../../types';

import type { IModuleCreateDTO } from '../../../../shared/types/dto/ModuleDTO';
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

function makeModule(id: string, filename: string, directory: string): IModuleCreateDTO {
  return {
    id,
    package_id: 'pkg-test',
    name: 'fixture',
    source: {
      directory,
      name: 'fixture.ts',
      filename,
      relativePath: 'fixture.ts',
    },
  };
}

function makeContext(parseResult: ParseResult, packageRoot: string): AnalyzerContext {
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

/**
 * Probe plugin availability so the test can soften assertions in minimal envs.
 * We funnel specifiers through a `string` variable so TypeScript doesn't try
 * to resolve them at compile time — that way the test compiles even if the
 * plugin packages haven't been installed yet.
 */
async function pluginsAvailable(): Promise<boolean> {
  const specifiers: string[] = [
    '@typescript-eslint/parser',
    '@typescript-eslint/eslint-plugin',
    'eslint-plugin-sonarjs',
    'eslint-plugin-unicorn',
  ];
  try {
    await Promise.all(specifiers.map((s) => import(/* @vite-ignore */ s)));
    return true;
  } catch {
    return false;
  }
}

describe('EslintAnalyzer', () => {
  let tmpDir: string;
  let fixturePath: string;
  let pluginsReady: boolean;

  const fixtureSource = [
    '/* eslint fixture: intentionally triggers @typescript-eslint/no-explicit-any */',
    'export const unsafeValue: any = 1;',
    '',
  ].join('\n');

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eslint-analyzer-test-'));
    fixturePath = join(tmpDir, 'fixture.ts');
    await writeFile(fixturePath, fixtureSource, 'utf-8');
    // Minimal tsconfig so type-aware rules can resolve.
    await writeFile(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ESNext',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            skipLibCheck: true,
          },
          include: ['*.ts'],
        },
        null,
        2
      ),
      'utf-8'
    );
    pluginsReady = await pluginsAvailable();
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has the expected static metadata', () => {
    const analyzer = new EslintAnalyzer();
    expect(analyzer.id).toBe('eslint');
    expect(analyzer.category).toBe('quality');
    expect(analyzer.requires).toEqual(['eslint']);
    expect(analyzer.enabled(createDefaultConfig())).toBe(true);
  });

  it('emits a code_issue for no-explicit-any in the fixture', async () => {
    const parseResult = makeEmptyParseResult();
    parseResult.modules.push(makeModule('mod-1', fixturePath, tmpDir));
    const ctx = makeContext(parseResult, tmpDir);

    const result = await new EslintAnalyzer().run(ctx);

    if (!pluginsReady) {
      // In minimal environments we only verify the no-crash contract.
      expect(result.findings ?? []).toEqual([]);
      return;
    }

    const findings = result.findings ?? [];
    expect(findings.length).toBeGreaterThan(0);

    const noExplicitAny = findings.find(
      (f) => f.rule_code === 'eslint.@typescript-eslint/no-explicit-any'
    );
    expect(noExplicitAny).toBeDefined();
    expect(noExplicitAny?.severity).toBe('warning');
    expect(noExplicitAny?.module_id).toBe('mod-1');
    expect(noExplicitAny?.package_id).toBe('pkg-test');
    expect(noExplicitAny?.file_path).toBe(fixturePath);
    expect(typeof noExplicitAny?.line).toBe('number');
    expect(typeof noExplicitAny?.column).toBe('number');
    // Deterministic UUID (v5) string.
    expect(noExplicitAny?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('skips .d.ts and non-ts modules', async () => {
    const parseResult = makeEmptyParseResult();
    // Add a .d.ts module and a .vue module — both should be filtered out.
    parseResult.modules.push(
      makeModule('mod-dts', join(tmpDir, 'types.d.ts'), tmpDir),
      makeModule('mod-vue', join(tmpDir, 'component.vue'), tmpDir)
    );
    const ctx = makeContext(parseResult, tmpDir);

    const result = await new EslintAnalyzer().run(ctx);
    expect(result.findings ?? []).toEqual([]);
  });
});
