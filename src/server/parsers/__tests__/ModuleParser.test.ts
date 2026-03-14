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

// ---------------------------------------------------------------------------
// Class parsing
// ---------------------------------------------------------------------------

describe('ModuleParser — class parsing', () => {
  it('captures both exported classes by name', async () => {
    const result = await parseFixture('class-full.input.ts');
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('Widget');
    expect(names).toContain('SpecialWidget');
  });

  it('captures deferred implements ref (Widget → Serializable)', async () => {
    const result = await parseFixture('class-full.input.ts');
    const widget = result.classes.find((c) => c.name === 'Widget');
    expect(widget).toBeDefined();
    const impl = result.classImplements.find((r) => r.classId === widget?.id);
    expect(impl).toBeDefined();
    expect(impl?.interfaceName).toBe('Serializable');
  });

  it('captures deferred extends ref (SpecialWidget → Widget)', async () => {
    const result = await parseFixture('class-full.input.ts');
    const special = result.classes.find((c) => c.name === 'SpecialWidget');
    expect(special).toBeDefined();
    const extendsRef = result.classExtends.find((r) => r.classId === special?.id);
    expect(extendsRef).toBeDefined();
    expect(extendsRef?.parentName).toBe('Widget');
  });

  it('leaves parentId undefined on classExtends (deferred, not resolved at parse time)', async () => {
    const result = await parseFixture('class-full.input.ts');
    for (const ref of result.classExtends) {
      expect(ref.parentId).toBeUndefined();
    }
  });

  it('captures async method with is_async: true', async () => {
    const result = await parseFixture('class-full.input.ts');
    const fetchMethod = result.methods.find((m) => m.name === 'fetch' && m.parent_type === 'class');
    expect(fetchMethod).toBeDefined();
    expect(fetchMethod?.is_async).toBe(true);
  });

  it('captures static method with is_static: true', async () => {
    const result = await parseFixture('class-full.input.ts');
    const createMethod = result.methods.find((m) => m.name === 'create');
    expect(createMethod).toBeDefined();
    expect(createMethod?.is_static).toBe(true);
  });

  it('captures readonly property with is_readonly: true', async () => {
    const result = await parseFixture('class-full.input.ts');
    const idProp = result.properties.find((p) => p.name === 'id' && p.parent_type === 'class');
    expect(idProp).toBeDefined();
    expect(idProp?.is_readonly).toBe(true);
  });

  it('captures private property with visibility: private', async () => {
    const result = await parseFixture('class-full.input.ts');
    const nameProp = result.properties.find((p) => p.name === 'name' && p.parent_type === 'class');
    expect(nameProp).toBeDefined();
    expect(nameProp?.visibility).toBe('private');
  });

  it('captures protected property with visibility: protected', async () => {
    const result = await parseFixture('class-full.input.ts');
    const countProp = result.properties.find((p) => p.name === 'count' && p.parent_type === 'class');
    expect(countProp).toBeDefined();
    expect(countProp?.visibility).toBe('protected');
  });

  it('captures static property with is_static: true', async () => {
    const result = await parseFixture('class-full.input.ts');
    const versionProp = result.properties.find((p) => p.name === 'version');
    expect(versionProp).toBeDefined();
    expect(versionProp?.is_static).toBe(true);
  });

  it('description is undefined for exported class (JSDoc attaches to ExportNamedDeclaration wrapper)', async () => {
    // Known limitation: extractJsDoc is called on the inner ClassDeclaration node, but
    // jscodeshift attaches leading comments to the outer ExportNamedDeclaration wrapper.
    const result = await parseFixture('class-full.input.ts');
    const widget = result.classes.find((c) => c.name === 'Widget');
    expect(widget?.description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Interface parsing
// ---------------------------------------------------------------------------

describe('ModuleParser — interface parsing', () => {
  it('captures all exported interfaces', async () => {
    const result = await parseFixture('interface-full.input.ts');
    const names = result.interfaces.map((i) => i.name);
    expect(names).toContain('Serializable');
    expect(names).toContain('Identifiable');
    expect(names).toContain('Repository');
    expect(names).toContain('ChildRepo');
  });

  it('captures two deferred extends refs for Repository', async () => {
    const result = await parseFixture('interface-full.input.ts');
    const repo = result.interfaces.find((i) => i.name === 'Repository');
    expect(repo).toBeDefined();
    const refs = result.interfaceExtends.filter((r) => r.interfaceId === repo?.id);
    expect(refs).toHaveLength(2);
    const parentNames = refs.map((r) => r.parentName).sort();
    expect(parentNames).toEqual(['Identifiable', 'Serializable']);
  });

  it('captures generic interface (type_parameters_json is set)', async () => {
    const result = await parseFixture('interface-full.input.ts');
    const repo = result.interfaces.find((i) => i.name === 'Repository');
    // Interface itself doesn't store type_parameters_json — but it has methods with generic return types
    expect(repo).toBeDefined();
  });

  it('captures interface methods', async () => {
    const result = await parseFixture('interface-full.input.ts');
    const repo = result.interfaces.find((i) => i.name === 'Repository');
    const methods = result.methods.filter((m) => m.parent_id === repo?.id);
    const methodNames = methods.map((m) => m.name);
    expect(methodNames).toContain('findById');
    expect(methodNames).toContain('save');
  });

  it('captures optional method (delete?)', async () => {
    const result = await parseFixture('interface-full.input.ts');
    const repo = result.interfaces.find((i) => i.name === 'Repository');
    const deleteMethod = result.methods.find((m) => m.parent_id === repo?.id && m.name === 'delete');
    expect(deleteMethod).toBeDefined();
  });

  it('captures interface properties with is_readonly', async () => {
    const result = await parseFixture('interface-full.input.ts');
    const repo = result.interfaces.find((i) => i.name === 'Repository');
    const idProp = result.properties.find((p) => p.parent_id === repo?.id && p.name === 'id');
    expect(idProp).toBeDefined();
    expect(idProp?.is_readonly).toBe(true);
  });

  it('description is undefined for exported interface (JSDoc attaches to ExportNamedDeclaration wrapper)', async () => {
    // Known limitation: extractJsDoc is called on the inner TSInterfaceDeclaration, but
    // jscodeshift attaches leading comments to the outer ExportNamedDeclaration wrapper.
    const result = await parseFixture('interface-full.input.ts');
    const repo = result.interfaces.find((i) => i.name === 'Repository');
    expect(repo?.description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Function parsing
// ---------------------------------------------------------------------------

describe('ModuleParser — function parsing', () => {
  it('captures only exported functions (3, not 4)', async () => {
    const result = await parseFixture('functions-exports.input.ts');
    expect(result.functions).toHaveLength(3);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('greet');
    expect(names).toContain('fetchData');
    expect(names).toContain('identity');
    expect(names).not.toContain('internalHelper');
  });

  it('marks async function with is_async: true', async () => {
    const result = await parseFixture('functions-exports.input.ts');
    const fetchFn = result.functions.find((f) => f.name === 'fetchData');
    expect(fetchFn?.is_async).toBe(true);
  });

  it('marks non-async function with is_async: false', async () => {
    const result = await parseFixture('functions-exports.input.ts');
    const greetFn = result.functions.find((f) => f.name === 'greet');
    expect(greetFn?.is_async).toBe(false);
  });

  it('marks all exported functions as is_exported: true', async () => {
    const result = await parseFixture('functions-exports.input.ts');
    for (const fn of result.functions) {
      expect(fn.is_exported).toBe(true);
    }
  });

  it('captures explicit return type (includes colon prefix from TSTypeAnnotation)', async () => {
    // getTypeFromAnnotation serializes the full TSTypeAnnotation node which includes ": "
    const result = await parseFixture('functions-exports.input.ts');
    const greetFn = result.functions.find((f) => f.name === 'greet');
    expect(greetFn?.return_type).toBe(': string');
    expect(greetFn?.has_explicit_return_type).toBe(true);
  });

  it('fetchData is async with optional opts parameter captured at function level', async () => {
    // Note: standalone function parameters are NOT stored in result.parameters
    // (only method parameters are). This test verifies function-level properties only.
    const result = await parseFixture('functions-exports.input.ts');
    const fetchFn = result.functions.find((f) => f.name === 'fetchData');
    expect(fetchFn).toBeDefined();
    expect(fetchFn?.is_async).toBe(true);
    expect(fetchFn?.has_explicit_return_type).toBe(true);
  });

  it('captures generic function (identity<T>)', async () => {
    const result = await parseFixture('functions-exports.input.ts');
    const identityFn = result.functions.find((f) => f.name === 'identity');
    expect(identityFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Enum and type alias parsing
// ---------------------------------------------------------------------------

describe('ModuleParser — enum parsing', () => {
  it('captures exported enums and excludes non-exported', async () => {
    const result = await parseFixture('enums-and-aliases.input.ts');
    const names = result.enums.map((e) => e.name);
    expect(names).toContain('Direction');
    expect(names).toContain('StatusCode');
    expect(names).not.toContain('InternalEnum');
  });

  it('captures Direction members as JSON array', async () => {
    const result = await parseFixture('enums-and-aliases.input.ts');
    const direction = result.enums.find((e) => e.name === 'Direction');
    expect(direction?.members_json).toBeDefined();
    const members = JSON.parse(direction!.members_json!) as string[];
    expect(members).toEqual(['Up', 'Down', 'Left', 'Right']);
  });

  it('captures StatusCode members as JSON array', async () => {
    const result = await parseFixture('enums-and-aliases.input.ts');
    const status = result.enums.find((e) => e.name === 'StatusCode');
    expect(status?.members_json).toBeDefined();
    const members = JSON.parse(status!.members_json!) as string[];
    expect(members).toEqual(['OK', 'NotFound', 'Error']);
  });
});

describe('ModuleParser — type alias parsing', () => {
  it('captures exported type aliases and excludes non-exported', async () => {
    const result = await parseFixture('enums-and-aliases.input.ts');
    const names = result.typeAliases.map((t) => t.name);
    expect(names).toContain('UserID');
    expect(names).toContain('Result');
    expect(names).not.toContain('InternalType');
  });

  it('captures type body for UserID', async () => {
    const result = await parseFixture('enums-and-aliases.input.ts');
    const userID = result.typeAliases.find((t) => t.name === 'UserID');
    expect(userID?.type).toBeDefined();
    expect(userID?.type).not.toBe('unknown');
  });

  it('captures generic type parameters for Result<T, E>', async () => {
    const result = await parseFixture('enums-and-aliases.input.ts');
    const resultType = result.typeAliases.find((t) => t.name === 'Result');
    expect(resultType?.type_parameters_json).toBeDefined();
    const params = JSON.parse(resultType!.type_parameters_json!) as string[];
    expect(params).toContain('T');
    expect(params).toContain('E');
  });
});

// ---------------------------------------------------------------------------
// Variable parsing
// ---------------------------------------------------------------------------

describe('ModuleParser — variable parsing', () => {
  it('captures exported non-destructured variables', async () => {
    const result = await parseFixture('variables.input.ts');
    const names = result.variables.map((v) => v.name);
    expect(names).toContain('MAX_RETRY');
    expect(names).toContain('API_URL');
    expect(names).toContain('mutableCounter');
    expect(names).toContain('handlers');
  });

  it('excludes destructured exports (const { a, b })', async () => {
    const result = await parseFixture('variables.input.ts');
    const names = result.variables.map((v) => v.name);
    expect(names).not.toContain('a');
    expect(names).not.toContain('b');
  });

  it('excludes non-exported variables', async () => {
    const result = await parseFixture('variables.input.ts');
    const names = result.variables.map((v) => v.name);
    expect(names).not.toContain('internalSecret');
  });

  it('captures type annotation on API_URL (includes colon prefix from TSTypeAnnotation)', async () => {
    const result = await parseFixture('variables.input.ts');
    const apiUrl = result.variables.find((v) => v.name === 'API_URL');
    expect(apiUrl?.type).toBe(': string');
  });

  it('captures variable kind (const vs let)', async () => {
    const result = await parseFixture('variables.input.ts');
    const maxRetry = result.variables.find((v) => v.name === 'MAX_RETRY');
    expect(maxRetry?.kind).toBe('const');
    const counter = result.variables.find((v) => v.name === 'mutableCounter');
    expect(counter?.kind).toBe('let');
  });

  it('captures initializer value', async () => {
    const result = await parseFixture('variables.input.ts');
    const maxRetry = result.variables.find((v) => v.name === 'MAX_RETRY');
    expect(maxRetry?.initializer).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// Barrel file detection
// ---------------------------------------------------------------------------

describe('ModuleParser — barrel file detection', () => {
  it('marks module as barrel when all exports are re-exports', async () => {
    const result = await parseFixture('barrel.input.ts');
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]?.source.isBarrel).toBe(true);
  });

  it('does not mark a non-barrel module as barrel', async () => {
    const result = await parseFixture('functions-exports.input.ts');
    expect(result.modules[0]?.source.isBarrel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tech debt detection
// ---------------------------------------------------------------------------

describe('ModuleParser — tech debt markers', () => {
  it('detects TODO comment marker', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'todo_comment')).toBe(true);
  });

  it('detects FIXME comment marker', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'fixme_comment')).toBe(true);
  });

  it('detects HACK comment marker', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'hack_comment')).toBe(true);
  });

  it('detects @ts-ignore directive', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'ts_ignore')).toBe(true);
  });

  it('detects any type usage', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'any_type')).toBe(true);
  });

  it('detects double type assertion (as unknown as)', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'type_assertion')).toBe(true);
  });

  it('detects non-null assertion (!.)', async () => {
    const result = await parseFixture('tech-debt.input.ts');
    const markers = result.techDebtMarkers ?? [];
    expect(markers.some((m) => m.type === 'non_null_assertion')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error recovery and sourceOverride
// ---------------------------------------------------------------------------

describe('ModuleParser — error recovery', () => {
  it('returns a valid empty ParseResult on syntax error (does not throw)', async () => {
    const malformedSource = 'export class Broken {\n  method(): void {\n';
    const parser = new ModuleParser('/nonexistent/malformed.ts', TEST_PACKAGE_ID, malformedSource);
    const result = await parser.parse();

    // Should not throw; should return a minimal ParseResult
    expect(result).toBeDefined();
    expect(result.modules).toHaveLength(1);
    expect(result.classes).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.interfaces).toEqual([]);
  });

  it('returned module DTO still has correct filePath after parse error', async () => {
    const malformedSource = 'export class { // missing name';
    const filePath = '/my/project/broken.ts';
    const parser = new ModuleParser(filePath, TEST_PACKAGE_ID, malformedSource);
    const result = await parser.parse();

    expect(result.modules[0]?.source.filename).toBe(filePath);
  });
});

describe('ModuleParser — sourceOverride', () => {
  it('uses override content instead of reading from disk', async () => {
    const source = `export const MAGIC = 42;`;
    // Non-existent path — would fail without sourceOverride
    const parser = new ModuleParser('/does/not/exist.ts', TEST_PACKAGE_ID, source);
    const result = await parser.parse();

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]?.name).toBe('MAGIC');
  });

  it('produces deterministic IDs from the filePath even when using sourceOverride', async () => {
    const source = `export const X = 1;`;
    const filePath = '/stable/path.ts';
    const r1 = await new ModuleParser(filePath, TEST_PACKAGE_ID, source).parse();
    const r2 = await new ModuleParser(filePath, TEST_PACKAGE_ID, source).parse();
    expect(r1.modules[0]?.id).toBe(r2.modules[0]?.id);
    expect(r1.variables[0]?.id).toBe(r2.variables[0]?.id);
  });
});
