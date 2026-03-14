// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceWithFiles } from '../../__tests__/tempWorkspace';
import { DependencyParser } from '../DependencyParser';
import { generatePackageUUID } from '../../utils/uuid';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('DependencyParser', () => {
  it('resolves dependency versions from package-lock when available', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'dependency-fixture',
          version: '1.0.0',
          dependencies: {
            lodash: '^4.17.0',
          },
          devDependencies: {
            vitest: '^4.1.0',
          },
        },
        null,
        2
      ),
      'package-lock.json': JSON.stringify(
        {
          lodash: {
            version: '4.17.21',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          },
        },
        null,
        2
      ),
    });
    cleanups.push(workspace.cleanup);

    const parser = new DependencyParser(workspace.root);
    const result = await parser.parseDependencies();

    expect(result.dependencies.get('lodash')).toBe(generatePackageUUID('lodash', '4.17.21'));
    expect(result.devDependencies.get('vitest')).toBe(generatePackageUUID('vitest', '^4.1.0'));
    expect(result.imports.has('lodash')).toBe(true);
    expect(result.imports.has('vitest')).toBe(true);
  });

  it('falls back to yarn.lock when package-lock is invalid', async () => {
    const workspace = await createWorkspaceWithFiles({
      'package.json': JSON.stringify(
        {
          name: 'dependency-fixture',
          version: '1.0.0',
          dependencies: {
            chalk: '^5.0.0',
          },
        },
        null,
        2
      ),
      'package-lock.json': '{ invalid-json }',
      'yarn.lock': `chalk@^5.0.0:
  version "5.6.2"
  resolved "https://registry.yarnpkg.com/chalk/-/chalk-5.6.2.tgz"
`,
    });
    cleanups.push(workspace.cleanup);

    const parser = new DependencyParser(workspace.root);
    const result = await parser.parseDependencies();

    expect(result.dependencies.get('chalk')).toBe(generatePackageUUID('chalk', '5.6.2'));
    const chalkImport = result.imports.get('chalk') as { resolution?: string } | undefined;
    expect(chalkImport).toBeDefined();
    expect(chalkImport?.resolution).toBe('5.6.2');
  });
});
