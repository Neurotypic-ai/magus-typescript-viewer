// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import jscodeshift from 'jscodeshift';

import {
  extractDecoratorNames,
  extractSymbolUsages,
  getHeritageClauseName,
  getIdentifierName,
  getTypeFromAnnotation,
} from '../astUtils';

import type { ASTNode } from 'jscodeshift';
import type { Logger } from '../../../../shared/utils/logger';

const j = jscodeshift.withParser('tsx');

// Minimal no-op logger for testing
const noopLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ---------------------------------------------------------------------------
// getIdentifierName
// ---------------------------------------------------------------------------

describe('getIdentifierName', () => {
  it('returns name from a string input', () => {
    expect(getIdentifierName('hello')).toBe('hello');
  });

  it('returns name from an Identifier node', () => {
    const root = j('const foo = 1;');
    const id = root.find(j.Identifier, { name: 'foo' }).get().node;
    expect(getIdentifierName(id)).toBe('foo');
  });

  it('returns null for a node without a name property', () => {
    // NumericLiteral has no .name
    const root = j('42;');
    const lit = root.find(j.NumericLiteral).get().node as ASTNode;
    expect(getIdentifierName(lit as never)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getHeritageClauseName
// ---------------------------------------------------------------------------

describe('getHeritageClauseName', () => {
  it('extracts Identifier name from TSExpressionWithTypeArguments (simple extends)', () => {
    const root = j('interface Foo extends Bar {}');
    const extendsClause = root.find(j.TSInterfaceDeclaration).get().node.extends?.[0] as ASTNode;
    expect(extendsClause).toBeDefined();
    expect(getHeritageClauseName(extendsClause)).toBe('Bar');
  });

  it('extracts rightmost name from MemberExpression in heritage clause (ns.Parent)', () => {
    // TypeScript: interface Foo extends ns.Bar {}
    const root = j('interface Foo extends ns.Bar {}');
    const extendsClause = root.find(j.TSInterfaceDeclaration).get().node.extends?.[0] as ASTNode;
    expect(extendsClause).toBeDefined();
    const name = getHeritageClauseName(extendsClause);
    expect(name).toBe('Bar');
  });

  it('returns null for a node with no recognizable structure', () => {
    // Pass a plain object that doesn't match any known pattern
    const bogus = { type: 'NumericLiteral', value: 42 } as ASTNode;
    expect(getHeritageClauseName(bogus)).toBeNull();
  });

  it('handles TSExpressionWithTypeArguments with generic arguments (Foo<T>)', () => {
    const root = j('interface Child extends Parent<string> {}');
    const extendsClause = root.find(j.TSInterfaceDeclaration).get().node.extends?.[0] as ASTNode;
    expect(extendsClause).toBeDefined();
    expect(getHeritageClauseName(extendsClause)).toBe('Parent');
  });
});

// ---------------------------------------------------------------------------
// getTypeFromAnnotation
// ---------------------------------------------------------------------------

describe('getTypeFromAnnotation', () => {
  it('returns "any" when annotation is null', () => {
    expect(getTypeFromAnnotation(j, null, noopLogger)).toBe('any');
  });

  it('returns "any" when annotation is undefined', () => {
    expect(getTypeFromAnnotation(j, undefined, noopLogger)).toBe('any');
  });

  it('serializes a simple string type annotation', () => {
    const root = j('const x: string = "";');
    const varDecl = root.find(j.VariableDeclarator).get().node;
    const annotation = (varDecl.id as { typeAnnotation?: unknown }).typeAnnotation;
    if (!annotation) throw new Error('No annotation found');
    const result = getTypeFromAnnotation(j, annotation as never, noopLogger);
    expect(result).toContain('string');
  });
});

// ---------------------------------------------------------------------------
// extractSymbolUsages
// ---------------------------------------------------------------------------

describe('extractSymbolUsages', () => {
  const baseContext = {
    moduleId: 'mod-test',
    sourceSymbolId: 'fn-test',
    sourceSymbolType: 'method' as const,
    sourceSymbolName: 'doWork',
  };

  it('captures a method call as targetKind: method', () => {
    const root = j('function doWork() { foo.bar(); }');
    const fn = root.find(j.FunctionDeclaration).get().node;
    const usages = extractSymbolUsages(j, fn, baseContext);

    const barUsage = usages.find((u) => u.targetName === 'bar');
    expect(barUsage).toBeDefined();
    expect(barUsage?.targetKind).toBe('method');
    expect(barUsage?.qualifierName).toBe('foo');
  });

  it('captures a property access as targetKind: property', () => {
    // Property access (not a callee) should be 'property'
    const root = j('function doWork() { const v = obj.status; }');
    const fn = root.find(j.FunctionDeclaration).get().node;
    const usages = extractSymbolUsages(j, fn, baseContext);

    const statusUsage = usages.find((u) => u.targetName === 'status');
    expect(statusUsage).toBeDefined();
    expect(statusUsage?.targetKind).toBe('property');
    expect(statusUsage?.qualifierName).toBe('obj');
  });

  it('captures this.method() with qualifierName: this', () => {
    // TSX parser produces ClassMethod nodes (Babel AST), not MethodDefinition (ESTree)
    const root = j('class C { doWork() { this.run(); } }');
    const method = root.find(j.ClassMethod, { key: { name: 'doWork' } }).get().node;
    const usages = extractSymbolUsages(j, method, {
      ...baseContext,
      sourceParentName: 'C',
      sourceParentType: 'class',
    });

    const runUsage = usages.find((u) => u.targetName === 'run');
    expect(runUsage).toBeDefined();
    expect(runUsage?.qualifierName).toBe('this');
    expect(runUsage?.targetKind).toBe('method');
  });

  it('deduplicates identical member accesses', () => {
    const root = j('function doWork() { foo.bar(); foo.bar(); foo.bar(); }');
    const fn = root.find(j.FunctionDeclaration).get().node;
    const usages = extractSymbolUsages(j, fn, baseContext);

    const barUsages = usages.filter((u) => u.targetName === 'bar');
    expect(barUsages).toHaveLength(1);
  });

  it('returns empty array when function body has no member expressions', () => {
    const root = j('function doWork() { return 42; }');
    const fn = root.find(j.FunctionDeclaration).get().node;
    const usages = extractSymbolUsages(j, fn, baseContext);
    expect(usages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractDecoratorNames
// ---------------------------------------------------------------------------

describe('extractDecoratorNames', () => {
  it('returns empty array when node has no decorators property', () => {
    const plain = { type: 'Identifier', name: 'foo' } as ASTNode;
    expect(extractDecoratorNames(plain)).toEqual([]);
  });

  it('returns empty array when decorators array is empty', () => {
    const node = { type: 'ClassDeclaration', decorators: [] } as ASTNode;
    expect(extractDecoratorNames(node)).toEqual([]);
  });

  it('extracts @Injectable style Identifier decorator name', () => {
    // Parse a decorated class and extract from the AST
    const source = `
      function Injectable() { return (t: any) => t; }
      @Injectable
      class MyService {}
    `;
    const root = j(source);
    const classNode = root.find(j.ClassDeclaration).get().node;
    const names = extractDecoratorNames(classNode as ASTNode);
    expect(names).toContain('Injectable');
  });

  it('extracts @Component({}) CallExpression decorator name', () => {
    const source = `
      function Component(opts: any) { return (t: any) => t; }
      @Component({ template: '<div />' })
      class MyComp {}
    `;
    const root = j(source);
    const classNode = root.find(j.ClassDeclaration).get().node;
    const names = extractDecoratorNames(classNode as ASTNode);
    expect(names).toContain('Component');
  });
});
