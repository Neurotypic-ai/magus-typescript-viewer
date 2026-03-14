// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceWithFiles } from '../../__tests__/tempWorkspace';
import { DEFAULT_FILE_DISCOVERY_CONFIG, FileDiscovery } from '../FileDiscovery';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('FileDiscovery', () => {
  it('collects analyzable files via traversal when tsconfig is missing', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/main.ts': 'export const main = true;',
      'src/component.vue': '<script setup lang="ts">const value = 1;</script>',
      'src/types.d.ts': 'export type Skip = string;',
      'dist/generated.ts': 'export const generated = true;',
      '.cache/temp.ts': 'export const cache = true;',
    });
    cleanups.push(workspace.cleanup);

    const discovery = new FileDiscovery(workspace.root, DEFAULT_FILE_DISCOVERY_CONFIG);
    const files = await discovery.collectFiles();
    const relativePaths = files.map((filePath) =>
      filePath.replace(`${workspace.root}/`, '').replace(/\\/g, '/')
    );

    expect(relativePaths.some((path) => path.endsWith('src/main.ts'))).toBe(true);
    expect(relativePaths.some((path) => path.endsWith('src/component.vue'))).toBe(true);
    expect(relativePaths.some((path) => path.endsWith('src/types.d.ts'))).toBe(false);
    expect(relativePaths.some((path) => path.startsWith('dist/'))).toBe(false);
    expect(relativePaths.some((path) => path.startsWith('.cache/'))).toBe(false);
  });

  it('falls back to traversal when tsconfig is invalid', async () => {
    const workspace = await createWorkspaceWithFiles({
      'tsconfig.json': '{ this-is: invalid json }',
      'src/entry.ts': 'export const entry = 1;',
    });
    cleanups.push(workspace.cleanup);

    const discovery = new FileDiscovery(workspace.root, DEFAULT_FILE_DISCOVERY_CONFIG);
    const files = await discovery.collectFiles();

    expect(files.some((filePath) => filePath.endsWith('/src/entry.ts'))).toBe(true);
  });
});
