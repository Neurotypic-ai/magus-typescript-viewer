import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTsMorphProject } from '../SharedProject';

/**
 * These tests exercise the shared ts-morph Project factory. When ts-morph is
 * not yet installed (early bootstrap phases), the factory returns null; in
 * that case we validate the null-path contract instead of asserting a real
 * Project instance.
 */
async function isTsMorphInstalled(): Promise<boolean> {
  // Computed specifier so TypeScript doesn't resolve the module at compile
  // time. Matches the approach used in SharedProject itself.
  const specifier = 'ts-morph';
  try {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- probe for optional dep
    await import(/* @vite-ignore */ specifier);
    return true;
  } catch {
    return false;
  }
}

describe('createTsMorphProject', () => {
  let tmpRoot: string;
  let tsMorphAvailable: boolean;

  beforeAll(async () => {
    tsMorphAvailable = await isTsMorphInstalled();
    tmpRoot = await mkdtemp(join(tmpdir(), 'shared-project-test-'));
    // Give the fake package a minimal but valid tsconfig.json.
    await writeFile(
      join(tmpRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
          },
          include: ['**/*.ts'],
        },
        null,
        2
      )
    );
    // Add one file so the project has at least one source file to load.
    await writeFile(join(tmpRoot, 'sample.ts'), 'export const answer = 42;\n');
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns a truthy Project when given a valid packageRoot with tsconfig.json', async () => {
    const project = await createTsMorphProject(tmpRoot);

    if (!tsMorphAvailable) {
      // ts-morph not installed — factory must return null and not throw.
      expect(project).toBeNull();
      return;
    }

    expect(project).not.toBeNull();
    // Rather than inspecting private internals, verify that the returned
    // object exposes the Project API analyzers rely on.
    expect(typeof (project as { getSourceFiles?: unknown }).getSourceFiles).toBe('function');
  });

  it('falls back to an empty Project when tsconfig.json is missing', async () => {
    const missingRoot = join(tmpRoot, 'does-not-exist-subdir');
    const project = await createTsMorphProject(missingRoot);

    if (!tsMorphAvailable) {
      expect(project).toBeNull();
      return;
    }

    expect(project).not.toBeNull();
    // Without a tsconfig the project still loads; it just starts with no
    // source files auto-added from disk.
    const getSourceFiles = (project as { getSourceFiles: () => unknown[] }).getSourceFiles;
    expect(typeof getSourceFiles).toBe('function');
    expect(Array.isArray(getSourceFiles.call(project))).toBe(true);
  });
});
