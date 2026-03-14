// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import jscodeshift from 'jscodeshift';

import { isBarrelFile, parseImportsAndExports } from '../parseImportsExports';

import type { Logger } from '../../../../shared/utils/logger';
import type { ModuleParserContext } from '../types';

const j = jscodeshift.withParser('tsx');

const noopLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeCtx(source: string): ModuleParserContext {
  return {
    j,
    root: j(source),
    packageId: 'pkg-1',
    moduleId: 'mod-1',
    filePath: 'virtual.ts',
    logger: noopLogger,
  };
}

// ---------------------------------------------------------------------------
// parseImportsAndExports — imports
// ---------------------------------------------------------------------------

describe('parseImportsAndExports — named imports', () => {
  it('parses a named import and returns it keyed by source path', () => {
    const ctx = makeCtx(`import { Foo } from './foo';`);
    const { imports } = parseImportsAndExports(ctx);
    expect(imports.has('./foo')).toBe(true);
    expect(imports.get('./foo')?.specifiers.has('Foo')).toBe(true);
  });

  it('records the specifier kind as "value" for a regular named import', () => {
    const ctx = makeCtx(`import { Bar } from './bar';`);
    const { imports } = parseImportsAndExports(ctx);
    expect(imports.get('./bar')?.specifiers.get('Bar')?.kind).toBe('value');
  });

  it('records the specifier kind as "type" for import type { X }', () => {
    const ctx = makeCtx(`import type { Baz } from './baz';`);
    const { imports } = parseImportsAndExports(ctx);
    expect(imports.get('./baz')?.specifiers.get('Baz')?.kind).toBe('type');
  });

  it('records specifier kind as "type" for inline type modifier (import { type X })', () => {
    const ctx = makeCtx(`import { type Qux } from './qux';`);
    const { imports } = parseImportsAndExports(ctx);
    const spec = imports.get('./qux')?.specifiers.get('Qux');
    expect(spec?.kind).toBe('type');
  });

  it('records alias in ImportSpecifier.aliases when import is aliased (Foo as F)', () => {
    const ctx = makeCtx(`import { Foo as F } from './foo';`);
    const { imports } = parseImportsAndExports(ctx);
    // Specifier is keyed under the local alias
    const spec = imports.get('./foo')?.specifiers.get('F');
    expect(spec).toBeDefined();
    expect(spec?.aliases.has('F')).toBe(true);
  });

  it('merges specifiers when the same source path is imported twice', () => {
    const ctx = makeCtx(`
import { Alpha } from './multi';
import { Beta } from './multi';
`);
    const { imports } = parseImportsAndExports(ctx);
    const imp = imports.get('./multi');
    expect(imp).toBeDefined();
    expect(imp?.specifiers.has('Alpha')).toBe(true);
    expect(imp?.specifiers.has('Beta')).toBe(true);
  });
});

describe('parseImportsAndExports — default and namespace imports', () => {
  it('parses a default import with kind "default"', () => {
    const ctx = makeCtx(`import Foo from './foo';`);
    const { imports } = parseImportsAndExports(ctx);
    const spec = imports.get('./foo')?.specifiers.get('Foo');
    expect(spec?.kind).toBe('default');
  });

  it('parses a namespace import with kind "namespace"', () => {
    const ctx = makeCtx(`import * as NS from './ns';`);
    const { imports } = parseImportsAndExports(ctx);
    const spec = imports.get('./ns')?.specifiers.get('NS');
    expect(spec?.kind).toBe('namespace');
  });

  it('parses a side-effect import (no specifiers) and creates an Import entry', () => {
    const ctx = makeCtx(`import './side-effect';`);
    const { imports } = parseImportsAndExports(ctx);
    expect(imports.has('./side-effect')).toBe(true);
    expect(imports.get('./side-effect')?.specifiers.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseImportsAndExports — exports
// ---------------------------------------------------------------------------

describe('parseImportsAndExports — local exports', () => {
  it('captures exported class name', () => {
    const ctx = makeCtx(`export class Widget {}`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('Widget')).toBe(true);
  });

  it('captures exported function name', () => {
    const ctx = makeCtx(`export function greet() {}`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('greet')).toBe(true);
  });

  it('captures exported const variable', () => {
    const ctx = makeCtx(`export const MAX = 42;`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('MAX')).toBe(true);
  });

  it('captures exported type alias', () => {
    const ctx = makeCtx(`export type ID = string;`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('ID')).toBe(true);
  });

  it('captures exported interface', () => {
    const ctx = makeCtx(`export interface IFoo { id: string; }`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('IFoo')).toBe(true);
  });

  it('captures exported enum', () => {
    const ctx = makeCtx(`export enum Direction { Up, Down }`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('Direction')).toBe(true);
  });

  it('captures export { X } local re-export without source', () => {
    const ctx = makeCtx(`
const Hidden = 1;
export { Hidden };
`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('Hidden')).toBe(true);
  });

  it('captures named default export class', () => {
    const ctx = makeCtx(`export default class App {}`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('App')).toBe(true);
  });

  it('captures export default identifier references', () => {
    const ctx = makeCtx(`
const config = {};
export default config;
`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('config')).toBe(true);
  });

  it('captures string-literal export aliases for local exports', () => {
    const ctx = makeCtx(`
const foo = 1;
export { foo as "bar" };
`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('bar')).toBe(true);
    expect(exports.has('foo')).toBe(false);
  });

  it('captures exported namespace names without leaking nested exports', () => {
    const ctx = makeCtx(`export namespace Ns { export const x = 1; }`);
    const { exports } = parseImportsAndExports(ctx);
    expect(exports.has('Ns')).toBe(true);
    expect(exports.has('x')).toBe(false);
  });
});

describe('parseImportsAndExports — re-exports', () => {
  it('captures named re-export (export { X } from "mod") as both export and reExport', () => {
    const ctx = makeCtx(`export { Widget } from './widget';`);
    const { exports, reExports } = parseImportsAndExports(ctx);
    expect(exports.has('Widget')).toBe(true);
    expect(reExports.has('Widget')).toBe(true);
  });

  it('captures export * from "mod" by adding "*" to reExports', () => {
    const ctx = makeCtx(`export * from './utils';`);
    const { reExports } = parseImportsAndExports(ctx);
    expect(reExports.has('*')).toBe(true);
  });

  it('captures string-literal export aliases for re-exports', () => {
    const ctx = makeCtx(`export { foo as "bar" } from './mod';`);
    const { exports, reExports } = parseImportsAndExports(ctx);
    expect(exports.has('bar')).toBe(true);
    expect(reExports.has('bar')).toBe(true);
  });

  it('does not add non-re-export names to reExports', () => {
    const ctx = makeCtx(`export class Local {}`);
    const { reExports } = parseImportsAndExports(ctx);
    expect(reExports.has('Local')).toBe(false);
  });
});

describe('parseImportsAndExports — empty source', () => {
  it('returns empty maps/sets for an empty module', () => {
    const ctx = makeCtx('');
    const { imports, exports, reExports } = parseImportsAndExports(ctx);
    expect(imports.size).toBe(0);
    expect(exports.size).toBe(0);
    expect(reExports.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isBarrelFile
// ---------------------------------------------------------------------------

describe('isBarrelFile', () => {
  it('returns false when there are no exports', () => {
    expect(isBarrelFile(new Set(), new Set())).toBe(false);
  });

  it('returns true when there is a wildcard re-export (*)', () => {
    const exports = new Set(['*']);
    const reExports = new Set(['*']);
    expect(isBarrelFile(exports, reExports)).toBe(true);
  });

  it('returns true when more than 80% of exports are re-exports', () => {
    const exports = new Set(['A', 'B', 'C', 'D', 'E']);
    const reExports = new Set(['A', 'B', 'C', 'D', 'E']); // 100%
    expect(isBarrelFile(exports, reExports)).toBe(true);
  });

  it('returns false when exactly 80% are re-exports (threshold is strictly > 0.8)', () => {
    // 4/5 = 0.8, which is NOT > 0.8
    const exports = new Set(['A', 'B', 'C', 'D', 'E']);
    const reExports = new Set(['A', 'B', 'C', 'D']);
    expect(isBarrelFile(exports, reExports)).toBe(false);
  });

  it('returns true when 81%+ are re-exports', () => {
    // 9/10 = 0.9 > 0.8
    const exports = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    const reExports = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    expect(isBarrelFile(exports, reExports)).toBe(true);
  });

  it('returns false when fewer than 80% are re-exports (mixed file)', () => {
    const exports = new Set(['A', 'B', 'C', 'D', 'E']);
    const reExports = new Set(['A']); // 20%
    expect(isBarrelFile(exports, reExports)).toBe(false);
  });

  it('returns false for a file with only local exports (no re-exports)', () => {
    const exports = new Set(['Widget', 'Button', 'Input']);
    const reExports = new Set<string>();
    expect(isBarrelFile(exports, reExports)).toBe(false);
  });
});
