// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'fs/promises';

import { createWorkspaceWithFiles } from '../../__tests__/tempWorkspace';
import { PackageParser } from '../../parsers/PackageParser';
import { RulesEngine } from '../../rules/RulesEngine';
import { RefactorEngine } from '../RefactorEngine';
import { allTransforms } from '../transforms/index';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function parseAndAnalyze(root: string): Promise<ReturnType<RulesEngine['analyze']>> {
  const parser = new PackageParser(root, 'fixture-package', '1.0.0');
  const parseResult = await parser.parse();
  const rules = new RulesEngine();
  return rules.analyze(parseResult);
}

describe('Rules -> Refactor round trip', () => {
  it('supports preview and execute flow for actionable issues', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'roundtrip-fixture',
          version: '1.0.0',
        },
        null,
        2
      ),
      'src/config.ts': `
        export interface Settings {
          mode: 'a' | 'b' | 'c';
          retries: number;
        }
      `,
    });
    cleanups.push(workspace.cleanup);

    const filePath = workspace.resolve('src/config.ts');
    const originalSource = await readFile(filePath, 'utf-8');
    const issues = await parseAndAnalyze(workspace.root);
    const issue = issues.find((candidate) => candidate.refactor_action === 'extract-type-union');

    expect(issue).toBeDefined();
    expect(issue?.refactor_context).toBeDefined();

    const engine = new RefactorEngine(workspace.root);
    const request = {
      filePath,
      action: issue?.refactor_action ?? '',
      context: issue?.refactor_context ?? {},
    };

    const preview = await engine.preview(request);
    expect(preview.success).toBe(true);
    expect(preview.transformedSource).toContain('type SettingsMode');

    const sourceAfterPreview = await readFile(filePath, 'utf-8');
    expect(sourceAfterPreview).toBe(originalSource);

    const executed = await engine.execute(request);
    expect(executed.success).toBe(true);

    const sourceAfterExecute = await readFile(filePath, 'utf-8');
    expect(sourceAfterExecute).toContain('type SettingsMode');
    expect(sourceAfterExecute).toContain('mode: SettingsMode');

    const issuesAfterRefactor = await parseAndAnalyze(workspace.root);
    expect(issuesAfterRefactor.some((candidate) => candidate.property_name === 'mode')).toBe(false);
  });

  it('fails safely when source no longer matches stale issue context', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'roundtrip-fixture',
          version: '1.0.0',
        },
        null,
        2
      ),
      'src/config.ts': `
        export interface Settings {
          mode: 'a' | 'b' | 'c';
        }
      `,
    });
    cleanups.push(workspace.cleanup);

    const filePath = workspace.resolve('src/config.ts');
    const issues = await parseAndAnalyze(workspace.root);
    const issue = issues.find((candidate) => candidate.refactor_action === 'extract-type-union');
    expect(issue).toBeDefined();

    const staleSource = `
      export interface Settings {
        retries: number;
      }
    `;
    await writeFile(filePath, staleSource, 'utf-8');

    const engine = new RefactorEngine(workspace.root);
    const result = await engine.execute({
      filePath,
      action: issue?.refactor_action ?? '',
      context: issue?.refactor_context ?? {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Property 'mode' not found");

    const finalSource = await readFile(filePath, 'utf-8');
    expect(finalSource).toContain('retries: number');
    expect(finalSource).not.toContain('type SettingsMode');
  });

  it('keeps rule actions and transform registry in sync', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'roundtrip-fixture',
          version: '1.0.0',
        },
        null,
        2
      ),
      'src/config.ts': `
        export interface Settings {
          mode: 'a' | 'b' | 'c';
        }
      `,
    });
    cleanups.push(workspace.cleanup);

    const issues = await parseAndAnalyze(workspace.root);
    const actionableIssues = issues.filter((issue) => Boolean(issue.refactor_action));
    const registeredActions = new Set(allTransforms.map((transform) => transform.action));

    expect(actionableIssues.length).toBeGreaterThan(0);
    actionableIssues.forEach((issue) => {
      expect(registeredActions.has(issue.refactor_action ?? '')).toBe(true);
    });
  });

  it('detects actionable union issues in Vue SFC scripts and fails safely on preview', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'roundtrip-fixture',
          version: '1.0.0',
        },
        null,
        2
      ),
      'src/Component.vue': `
        <template><div /></template>
        <script lang="ts">
        export interface Settings {
          mode: 'a' | 'b' | 'c';
        }
        </script>
      `,
    });
    cleanups.push(workspace.cleanup);

    const filePath = workspace.resolve('src/Component.vue');
    const issues = await parseAndAnalyze(workspace.root);
    const issue = issues.find(
      (candidate) =>
        candidate.file_path.endsWith('Component.vue') && candidate.refactor_action === 'extract-type-union'
    );

    expect(issue).toBeDefined();

    const engine = new RefactorEngine(workspace.root);
    const preview = await engine.preview({
      filePath,
      action: issue?.refactor_action ?? '',
      context: issue?.refactor_context ?? {},
    });

    expect(preview.success).toBe(false);
    expect(preview.error).toContain('Transform failed');
  });
});
