// @vitest-environment node
import { describe, expect, it } from 'vitest';
import jscodeshift from 'jscodeshift';

import { extractJsDoc, extractJsDocTags } from '../extractJsDoc';

const j = jscodeshift.withParser('tsx');

/**
 * Helper: parse source code and return the first statement's AST node.
 */
function getFirstNode(source: string) {
  const root = j(source);
  const firstPath = root.find(j.Statement).at(0);
  return firstPath.get().node;
}

/**
 * Helper: parse source and return the first function declaration node.
 */
function getFirstFunction(source: string) {
  const root = j(source);
  const firstPath = root.find(j.FunctionDeclaration).at(0);
  return firstPath.get().node;
}

/**
 * Helper: parse source and return the first class declaration node.
 */
function getFirstClass(source: string) {
  const root = j(source);
  const firstPath = root.find(j.ClassDeclaration).at(0);
  return firstPath.get().node;
}

describe('extractJsDoc', () => {
  it('extracts a simple JSDoc block comment', () => {
    const source = `
/** This is a simple description. */
function foo() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    expect(result).toBe('This is a simple description.');
  });

  it('extracts a multi-line JSDoc description', () => {
    const source = `
/**
 * This is line one.
 * This is line two.
 * This is line three.
 */
function bar() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    expect(result).toBe('This is line one.\nThis is line two.\nThis is line three.');
  });

  it('returns undefined when no JSDoc comment is present', () => {
    const source = `function noDoc() {}`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    expect(result).toBeUndefined();
  });

  it('ignores line comments (only block comments are JSDoc)', () => {
    const source = `
// This is a line comment
function lineOnly() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    expect(result).toBeUndefined();
  });

  it('ignores non-JSDoc block comments (no leading double-star)', () => {
    const source = `
/* This is a regular block comment, not JSDoc */
function notJsDoc() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    // Regular block comments don't start with * after the opening /*
    // The parser stores the value without the outer delimiters, so
    // /* This is... */ has value " This is..." which does not start with *
    expect(result).toBeUndefined();
  });

  it('extracts JSDoc from a class declaration', () => {
    const source = `
/**
 * Represents a user in the system.
 */
class User {
  name: string = '';
}
`;
    const node = getFirstClass(source);
    const result = extractJsDoc(node);
    expect(result).toBe('Represents a user in the system.');
  });

  it('extracts TSDoc-style comments (same format as JSDoc)', () => {
    const source = `
/**
 * A TSDoc-style comment with inline tags.
 * See {@link OtherClass} for details.
 */
function tsdoc() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    expect(result).toContain('A TSDoc-style comment with inline tags.');
    expect(result).toContain('{@link OtherClass}');
  });

  it('handles JSDoc with only tags (no description text)', () => {
    const source = `
/**
 * @param x - The x coordinate
 */
function onlyTags(x: number) {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDoc(node);
    expect(result).toBeDefined();
    expect(result).toContain('@param');
  });
});

describe('extractJsDocTags', () => {
  it('extracts description and @param tags', () => {
    const source = `
/**
 * Adds two numbers together.
 * @param a - The first number
 * @param b - The second number
 */
function add(a: number, b: number) { return a + b; }
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.description).toBe('Adds two numbers together.');
    expect(result.params).toHaveLength(2);
    expect(result.params![0]).toEqual({ name: 'a', description: 'The first number' });
    expect(result.params![1]).toEqual({ name: 'b', description: 'The second number' });
  });

  it('extracts @param tags with type annotations', () => {
    const source = `
/**
 * A function.
 * @param {string} name - The name
 * @param {number} age - The age
 */
function create(name: string, age: number) {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.params).toHaveLength(2);
    expect(result.params![0]).toEqual({
      name: 'name',
      type: 'string',
      description: 'The name',
    });
    expect(result.params![1]).toEqual({
      name: 'age',
      type: 'number',
      description: 'The age',
    });
  });

  it('extracts @returns tag', () => {
    const source = `
/**
 * Gets the total.
 * @returns The sum of all values
 */
function getTotal(): number { return 0; }
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.description).toBe('Gets the total.');
    expect(result.returns).toEqual({ description: 'The sum of all values' });
  });

  it('extracts @returns tag with type', () => {
    const source = `
/**
 * Gets a name.
 * @returns {string} The name
 */
function getName(): string { return ''; }
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.returns).toEqual({ type: 'string', description: 'The name' });
  });

  it('handles @return as alias for @returns', () => {
    const source = `
/**
 * @return The value
 */
function getValue() { return 1; }
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.returns).toEqual({ description: 'The value' });
  });

  it('extracts @deprecated tag without message', () => {
    const source = `
/**
 * Old function.
 * @deprecated
 */
function oldFunc() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.description).toBe('Old function.');
    expect(result.deprecated).toBe(true);
  });

  it('extracts @deprecated tag with message', () => {
    const source = `
/**
 * Old function.
 * @deprecated Use newFunc() instead.
 */
function oldFunc() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.deprecated).toBe('Use newFunc() instead.');
  });

  it('extracts @example tags', () => {
    const source = `
/**
 * Adds numbers.
 * @example
 * add(1, 2) // returns 3
 * @example
 * add(0, 0) // returns 0
 */
function add(a: number, b: number) { return a + b; }
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.example).toHaveLength(2);
    expect(result.example![0]).toContain('add(1, 2)');
    expect(result.example![1]).toContain('add(0, 0)');
  });

  it('collects unrecognized tags in the catch-all tags array', () => {
    const source = `
/**
 * A function.
 * @since 1.0.0
 * @see OtherClass
 */
function tagged() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.tags).toHaveLength(2);
    expect(result.tags![0]).toEqual({ tag: 'since', value: '1.0.0' });
    expect(result.tags![1]).toEqual({ tag: 'see', value: 'OtherClass' });
  });

  it('returns empty object when no JSDoc is present', () => {
    const source = `function noDoc() {}`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result).toEqual({});
  });

  it('returns empty object for line comments', () => {
    const source = `
// A line comment
function lineComment() {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result).toEqual({});
  });

  it('handles multi-line description before tags', () => {
    const source = `
/**
 * First line of description.
 * Second line of description.
 *
 * Third paragraph.
 * @param x - A value
 */
function multi(x: number) {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.description).toContain('First line of description.');
    expect(result.description).toContain('Second line of description.');
    expect(result.description).toContain('Third paragraph.');
    expect(result.params).toHaveLength(1);
    expect(result.params![0].name).toBe('x');
  });

  it('handles @param without description', () => {
    const source = `
/**
 * @param x
 */
function simple(x: number) {}
`;
    const node = getFirstFunction(source);
    const result = extractJsDocTags(node);

    expect(result.params).toHaveLength(1);
    expect(result.params![0]).toEqual({ name: 'x' });
  });
});
