// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { ModuleParser } from '../ModuleParser';

const TEST_PACKAGE_ID = 'test-package-id';
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function parseFixture(filename: string) {
  const filePath = join(fixturesDir, filename);
  const parser = new ModuleParser(filePath, TEST_PACKAGE_ID);
  return parser.parse();
}

describe('ModuleParser.parseImportsAndExports', () => {
  it('captures default imports', async () => {
    const result = await parseFixture('default-imports.input.ts');

    expect(result.imports).toHaveLength(3);
    const reactImport = result.imports.find((imp) => imp.fullPath === 'react');
    expect(reactImport).toBeDefined();
    expect(reactImport?.specifiers.has('React')).toBe(true);
    expect(reactImport?.specifiers.get('React')?.kind).toBe('default');

    const componentImport = result.imports.find((imp) => imp.fullPath === './Component');
    expect(componentImport).toBeDefined();
    expect(componentImport?.specifiers.has('Component')).toBe(true);
    expect(componentImport?.specifiers.get('Component')?.kind).toBe('default');
  });

  it('captures namespace imports', async () => {
    const result = await parseFixture('namespace-imports.input.ts');

    expect(result.imports).toHaveLength(3);
    const reactImport = result.imports.find((imp) => imp.fullPath === 'react');
    expect(reactImport).toBeDefined();
    expect(reactImport?.specifiers.has('React')).toBe(true);
    expect(reactImport?.specifiers.get('React')?.kind).toBe('value');
  });

  it('captures type-only imports', async () => {
    const result = await parseFixture('type-only-imports.input.ts');

    expect(result.imports).toHaveLength(3);
    const typesImport = result.imports.find((imp) => imp.fullPath === './types');
    expect(typesImport).toBeDefined();
    const userSpec = Array.from(typesImport?.specifiers.values() ?? []).find((s) => s.name === 'User');
    expect(userSpec?.kind).toBe('type');

    const typeNamespaceSpec = Array.from(typesImport?.specifiers.values() ?? []).find((s) => s.name === 'Types');
    expect(typeNamespaceSpec?.kind).toBe('type');
  });

  it('captures side-effect imports with empty specifiers', async () => {
    const result = await parseFixture('side-effect-imports.input.ts');

    expect(result.imports).toHaveLength(3);
    const polyfillsImport = result.imports.find((imp) => imp.fullPath === './polyfills');
    expect(polyfillsImport).toBeDefined();
    expect(polyfillsImport?.specifiers.size).toBe(0);
  });

  it('captures mixed imports', async () => {
    const result = await parseFixture('mixed-imports.input.ts');

    const reactImport = result.imports.find((imp) => imp.fullPath === 'react');
    expect(reactImport).toBeDefined();
    expect(reactImport?.specifiers.has('React')).toBe(true);
    expect(reactImport?.specifiers.get('React')?.kind).toBe('default');
    expect(reactImport?.specifiers.has('useState')).toBe(true);

    const utilsImport = result.imports.find((imp) => imp.fullPath === './utils');
    expect(utilsImport).toBeDefined();
    expect(utilsImport?.specifiers.has('utils')).toBe(true);

    const stylesImport = result.imports.find((imp) => imp.fullPath === './styles.css');
    expect(stylesImport).toBeDefined();
    expect(stylesImport?.specifiers.size).toBe(0);
  });

  it('captures class extends as deferred name reference', async () => {
    const result = await parseFixture('extends-class.input.ts');
    const baseClass = result.classes.find((cls) => cls.name === 'BaseClass');
    const childClass = result.classes.find((cls) => cls.name === 'ChildClass');

    expect(baseClass).toBeDefined();
    expect(childClass).toBeDefined();

    // extends_id is NOT set during parsing — resolution is deferred to PackageParser/CLI
    expect(childClass?.extends_id).toBeUndefined();

    // Instead, classExtends carries the deferred reference by name
    const extendsRef = result.classExtends.find((ref) => ref.classId === childClass?.id);
    expect(extendsRef).toBeDefined();
    expect(extendsRef?.parentName).toBe('BaseClass');
  });
});
