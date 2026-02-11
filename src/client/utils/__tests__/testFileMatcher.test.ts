import { describe, expect, it } from 'vitest';

import { isTestFilePath } from '../testFileMatcher';

describe('testFileMatcher', () => {
  it('matches common test path patterns', () => {
    expect(isTestFilePath('src/foo/bar.test.ts')).toBe(true);
    expect(isTestFilePath('src/foo/bar.spec.tsx')).toBe(true);
    expect(isTestFilePath('src/foo/__tests__/bar.ts')).toBe(true);
    expect(isTestFilePath('src/integration/bar.ts')).toBe(true);
    expect(isTestFilePath('src/e2e/bar.ts')).toBe(true);
  });

  it('does not match normal source files', () => {
    expect(isTestFilePath('src/client/components/Foo.ts')).toBe(false);
    expect(isTestFilePath('src/server/services/Parser.ts')).toBe(false);
    expect(isTestFilePath(undefined)).toBe(false);
  });
});
