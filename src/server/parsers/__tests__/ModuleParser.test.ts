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
    expect(reactImport?.specifiers.get('React')?.kind).toBe('namespace');
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
    expect(reactImport?.specifiers.get('React')?.kind).toBe('namespace');
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

  it('captures local export specifiers and aliases', async () => {
    const result = await parseFixture('local-exports.input.ts');
    const exportNames = result.exports.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));

    expect(exportNames).toEqual(['defaultLabel', 'foo', 'renamedBar']);
    expect(exportNames.includes('bar')).toBe(false);
  });

  it('keeps anonymous default exports out of named export list', async () => {
    const result = await parseFixture('anonymous-default-exports.input.ts');
    expect(result.exports).toHaveLength(0);
  });
});

describe('ModuleParser symbol extraction', () => {
  it('extracts call graph edges from exported function bodies', async () => {
    const result = await parseFixture('call-edges.input.ts');
    const edgeSet = new Set(
      (result.callEdges ?? []).map(
        (edge) => `${edge.calleeName}:${edge.callType}:${edge.qualifier ?? 'none'}`
      )
    );

    expect(edgeSet.has('helper:function:none')).toBe(true);
    expect(edgeSet.has('process:method:thisLike')).toBe(true);
    expect(edgeSet.has('build:static:Service')).toBe(true);
    expect(edgeSet.has('Widget:constructor:none')).toBe(true);
    expect(edgeSet.has('run:method:instance')).toBe(true);
  });

  it('extracts method/property/parameter type references from complex members', async () => {
    const result = await parseFixture('complex-members.input.ts');
    const references = result.typeReferences ?? [];
    const referenceKeys = new Set(
      references.map((ref) => `${ref.typeName}:${ref.context}:${ref.sourceKind}`)
    );

    expect(referenceKeys.has('LabelType:property_type:property')).toBe(true);
    expect(referenceKeys.has('InputValue:parameter_type:parameter')).toBe(true);
    expect(referenceKeys.has('WorkerResult:return_type:method')).toBe(true);
    expect(referenceKeys.has('RunPayload:parameter_type:parameter')).toBe(true);

    expect(result.methods.some((method) => method.name === 'configure')).toBe(true);
    expect(result.methods.some((method) => method.name === 'run')).toBe(true);
  });
});
