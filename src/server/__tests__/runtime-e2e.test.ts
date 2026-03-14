// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { normalizeForGolden } from './normalizers';
import { createWorkspaceWithFiles } from './tempWorkspace';
import { ApiServerResponder } from '../ApiServerResponder';

const execFileAsync = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('server runtime e2e', () => {
  it('persists CLI analysis data and serves parser/analyzer outputs through ApiServerResponder', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'runtime-e2e-fixture',
          version: '1.0.0',
        },
        null,
        2
      ),
      'src/a.ts': `
        import { b } from './b';

        export interface Settings {
          mode: 'a' | 'b' | 'c';
        }

        export const a = b + 1;
      `,
      'src/b.ts': `
        import { a } from './a';

        export const b = a ? 1 : 0;
      `,
    });
    cleanups.push(workspace.cleanup);

    const dbPath = workspace.resolve('analysis.duckdb');
    await execFileAsync(
      'node',
      [
        '--import',
        'tsx',
        'src/server/bin/typescript-viewer.ts',
        'analyze',
        workspace.root,
        '--output',
        dbPath,
        '--format',
        'json',
      ],
      {
        cwd: process.cwd(),
      }
    );

    const responder = new ApiServerResponder({
      dbPath,
      readOnly: true,
    });
    await responder.initialize();

    const packages = await responder.getPackages();
    expect(packages).toHaveLength(1);

    const packageId = packages[0]?.id;
    expect(packageId).toBeDefined();

    const modules = await responder.getModules(packageId ?? '');
    const issues = await responder.getCodeIssues();
    const insights = await responder.getInsights(packageId);

    const goldenShape = normalizeForGolden({
      packageNames: packages.map((pkg) => pkg.name).sort((a, b) => a.localeCompare(b)),
      hasModuleA: modules.some((module) => module.source.relativePath.endsWith('src/a.ts')),
      hasModuleB: modules.some((module) => module.source.relativePath.endsWith('src/b.ts')),
      issueCodes: issues.map((issue) => issue.rule_code).sort((a, b) => a.localeCompare(b)),
      hasCircularInsight: insights.insights.some((insight) => insight.type === 'circular-imports'),
      healthScore: insights.healthScore,
    });

    expect(goldenShape).toMatchObject({
      packageNames: ['runtime-e2e-fixture'],
      hasModuleA: true,
      hasModuleB: true,
      hasCircularInsight: true,
    });
    expect(goldenShape.issueCodes.includes('type-union-without-alias')).toBe(true);
    expect(goldenShape.healthScore).toBeLessThan(100);
  });
});
