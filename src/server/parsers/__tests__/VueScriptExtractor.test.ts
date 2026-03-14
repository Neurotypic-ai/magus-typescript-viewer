// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceWithFiles } from '../../__tests__/tempWorkspace';
import { VueScriptExtractor } from '../VueScriptExtractor';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('VueScriptExtractor', () => {
  it('combines valid inline script blocks and skips external/unsupported blocks', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/component.vue': `
        <template><div>Hello</div></template>
        <script lang="ts">
        const fromTs = 1;
        </script>
        <script setup lang="js">
        const fromSetup = 2;
        </script>
        <script src="./external.ts"></script>
        <script lang="coffee">
        console.log('skip');
        </script>
      `,
    });
    cleanups.push(workspace.cleanup);

    const extractor = new VueScriptExtractor();
    const source = await extractor.getSourceOverride(workspace.resolve('src/component.vue'));

    expect(source).toContain('const fromTs = 1;');
    expect(source).toContain('const fromSetup = 2;');
    expect(source).not.toContain('external.ts');
    expect(source).not.toContain('console.log');
  });

  it('returns undefined for non-vue files', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/not-vue.ts': 'export const value = 1;',
    });
    cleanups.push(workspace.cleanup);

    const extractor = new VueScriptExtractor();
    const source = await extractor.getSourceOverride(workspace.resolve('src/not-vue.ts'));

    expect(source).toBeUndefined();
  });

  it('returns empty string when the .vue file has no script blocks at all', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/template-only.vue': `
        <template><div>Hello</div></template>
        <style scoped>.foo { color: red; }</style>
      `,
    });
    cleanups.push(workspace.cleanup);

    const extractor = new VueScriptExtractor();
    const source = await extractor.getSourceOverride(workspace.resolve('src/template-only.vue'));

    expect(source).toBe('');
  });

  it('extracts bare <script> block with no lang attribute', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/options-api.vue': `
        <template><div /></template>
        <script>
        export default { name: 'OptionsComp' };
        </script>
      `,
    });
    cleanups.push(workspace.cleanup);

    const extractor = new VueScriptExtractor();
    const source = await extractor.getSourceOverride(workspace.resolve('src/options-api.vue'));

    expect(source).toContain("export default { name: 'OptionsComp' }");
  });

  it('extracts script with single-quoted lang attribute', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/single-quote.vue': `
        <template><div /></template>
        <script lang='ts'>
        const singleQuoteLang = true;
        </script>
      `,
    });
    cleanups.push(workspace.cleanup);

    const extractor = new VueScriptExtractor();
    const source = await extractor.getSourceOverride(workspace.resolve('src/single-quote.vue'));

    expect(source).toContain('const singleQuoteLang = true');
  });

  it('extracts script with lang="typescript"', async () => {
    const workspace = await createWorkspaceWithFiles({
      'src/typescript-lang.vue': `
        <template><div /></template>
        <script lang="typescript">
        const fromTypescript = 1;
        </script>
      `,
    });
    cleanups.push(workspace.cleanup);

    const extractor = new VueScriptExtractor();
    const source = await extractor.getSourceOverride(workspace.resolve('src/typescript-lang.vue'));

    expect(source).toContain('const fromTypescript = 1;');
  });
});
