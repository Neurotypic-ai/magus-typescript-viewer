// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { PackageParser } from '../PackageParser';

const temporaryDirectories: string[] = [];

async function createTempPackage(files: Record<string, string>): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'package-parser-'));
  temporaryDirectories.push(tempDirectory);

  await writeFile(
    join(tempDirectory, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-package',
        version: '1.0.0',
      },
      null,
      2
    )
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(tempDirectory, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return tempDirectory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      })
    )
  );
});

describe('PackageParser relationship resolution', () => {
  it('resolves unique class/interface relationships to explicit IDs', async () => {
    const packagePath = await createTempPackage({
      'src/base.ts': `export class Base {}`,
      'src/contracts.ts': `
        export interface Repo {}
        export interface Root {}
      `,
      'src/user.ts': `
        import { Base } from './base';
        import type { Repo, Root } from './contracts';

        export class User extends Base implements Repo {}
        export interface Child extends Root {}
      `,
    });

    const parser = new PackageParser(packagePath, 'fixture-package', '1.0.0');
    const result = await parser.parse();

    const baseClass = result.classes.find((cls) => cls.name === 'Base');
    const userClass = result.classes.find((cls) => cls.name === 'User');
    const repoInterface = result.interfaces.find((iface) => iface.name === 'Repo');
    const rootInterface = result.interfaces.find((iface) => iface.name === 'Root');
    const childInterface = result.interfaces.find((iface) => iface.name === 'Child');

    const extendsRef = result.classExtends.find((ref) => ref.classId === userClass?.id);
    expect(extendsRef?.parentName).toBe('Base');
    expect(extendsRef?.parentId).toBe(baseClass?.id);

    const implementsRef = result.classImplements.find((ref) => ref.classId === userClass?.id);
    expect(implementsRef?.interfaceName).toBe('Repo');
    expect(implementsRef?.interfaceId).toBe(repoInterface?.id);

    const interfaceExtendsRef = result.interfaceExtends.find((ref) => ref.interfaceId === childInterface?.id);
    expect(interfaceExtendsRef?.parentName).toBe('Root');
    expect(interfaceExtendsRef?.parentId).toBe(rootInterface?.id);
  });

  it('skips ambiguous local name matches', async () => {
    const packagePath = await createTempPackage({
      'src/base-one.ts': `export class Base {}`,
      'src/base-two.ts': `export class Base {}`,
      'src/child.ts': `export class Child extends Base {}`,
    });

    const parser = new PackageParser(packagePath, 'fixture-package', '1.0.0');
    const result = await parser.parse();

    expect(result.classes.filter((cls) => cls.name === 'Base')).toHaveLength(2);

    const childClass = result.classes.find((cls) => cls.name === 'Child');
    const extendsRef = result.classExtends.find((ref) => ref.classId === childClass?.id);
    expect(extendsRef?.parentName).toBe('Base');
    expect(extendsRef?.parentId).toBeUndefined();
  });
});

describe('PackageParser source coverage', () => {
  it('parses js files and vue script blocks while keeping template-only modules', async () => {
    const packagePath = await createTempPackage({
      'src/util.js': `export const util = 1;`,
      'src/component.vue': `
        <template><div>Component</div></template>
        <script setup lang="ts">
        import { util } from './util';
        const localValue = util;
        void localValue;
        </script>
      `,
      'src/template-only.vue': `<template><div>Template only</div></template>`,
    });

    const parser = new PackageParser(packagePath, 'fixture-package', '1.0.0');
    const result = await parser.parse();

    expect(result.modules.some((module) => module.source.relativePath.endsWith('src/util.js'))).toBe(true);
    expect(result.modules.some((module) => module.source.relativePath.endsWith('src/component.vue'))).toBe(true);
    expect(result.modules.some((module) => module.source.relativePath.endsWith('src/template-only.vue'))).toBe(true);

    const componentModule = result.modules.find((module) => module.source.relativePath.endsWith('src/component.vue'));
    const componentImports = (result.importsWithModules ?? []).filter((item) => item.moduleId === componentModule?.id);
    expect(componentImports.some((item) => item.import.relativePath === './util')).toBe(true);

    const templateOnlyModule = result.modules.find((module) => module.source.relativePath.endsWith('src/template-only.vue'));
    const templateOnlyImports = (result.importsWithModules ?? []).filter((item) => item.moduleId === templateOnlyModule?.id);
    expect(templateOnlyImports).toHaveLength(0);
  });

  it('respects tsconfig discovery and excludes generated/vendor directories', async () => {
    const packagePath = await createTempPackage({
      'tsconfig.json': JSON.stringify(
        {
          include: ['src/**/*', 'apps/**/*'],
        },
        null,
        2
      ),
      'src/keep.ts': `export const keep = true;`,
      'src/keep.vue': `<script setup lang="ts">const keepVue = true; void keepVue;</script>`,
      'apps/feature/entry.ts': `export const entry = 'ok';`,
      'dist/skip.ts': `export const skipDist = true;`,
      'build/skip.ts': `export const skipBuild = true;`,
      'coverage/skip.ts': `export const skipCoverage = true;`,
      '.cache/skip.ts': `export const skipCache = true;`,
      'node_modules/pkg/index.ts': `export const skipNodeModules = true;`,
    });

    const parser = new PackageParser(packagePath, 'fixture-package', '1.0.0');
    const result = await parser.parse();

    const relativePaths = result.modules
      .map((module) => module.source.relativePath.replace(/\\/g, '/'))
      .sort((a, b) => a.localeCompare(b));

    expect(relativePaths.some((path) => path.endsWith('src/keep.ts'))).toBe(true);
    expect(relativePaths.some((path) => path.endsWith('src/keep.vue'))).toBe(true);
    expect(relativePaths.some((path) => path.endsWith('apps/feature/entry.ts'))).toBe(true);

    expect(relativePaths.some((path) => path.startsWith('dist/'))).toBe(false);
    expect(relativePaths.some((path) => path.startsWith('build/'))).toBe(false);
    expect(relativePaths.some((path) => path.startsWith('coverage/'))).toBe(false);
    expect(relativePaths.some((path) => path.includes('node_modules/'))).toBe(false);
    expect(relativePaths.some((path) => path.startsWith('.cache/'))).toBe(false);
  });
});
