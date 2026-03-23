import { describe, expect, it } from 'vitest';

import {
  buildDetailDisplayModel,
  buildTypeDisplayModel,
  prettyPrintObjectLikeType,
  scanDelimitersUpTo,
  splitTopLevelUnionParts,
} from '../typeDisplay';

describe('typeDisplay', () => {
  it('does not split | inside generics', () => {
    const s = 'Foo<A | B>';
    expect(splitTopLevelUnionParts(s)).toBeNull();
    expect(buildTypeDisplayModel(s).kind).toBe('plain');
  });

  it('splits top-level union members', () => {
    const s = 'string | number | boolean';
    expect(splitTopLevelUnionParts(s)).toEqual(['string', 'number', 'boolean']);
    const m = buildTypeDisplayModel(s);
    expect(m.kind).toBe('unionRows');
    expect(m.unionMembers).toEqual(['string', 'number', 'boolean']);
  });

  it('splits union with object members', () => {
    const s = '{ a: string } | { b: number }';
    const parts = splitTopLevelUnionParts(s);
    expect(parts).toEqual(['{ a: string }', '{ b: number }']);
  });

  it('handles function union without splitting inside params incorrectly', () => {
    const s = '(() => void) | null';
    const parts = splitTopLevelUnionParts(s);
    expect(parts).toEqual(['(() => void)', 'null']);
  });

  it('scanDelimitersUpTo tracks nested delimiters', () => {
    const s = 'Foo<A | B>';
    const atPipe = s.indexOf('|');
    const st = scanDelimitersUpTo(s, atPipe);
    expect(st.angle).toBeGreaterThan(0);
  });

  it('pretty-prints a simple object type', () => {
    const s = '{ a: string; b: number }';
    const out = prettyPrintObjectLikeType(s);
    expect(out).toBeTruthy();
    expect(out).toContain('\n');
    expect(out).toContain('a: string');
    expect(out).toContain('b: number');
  });

  it('buildDetailDisplayModel prefixes (): for function entity details', () => {
    const d = '(): string | number';
    const m = buildDetailDisplayModel(d);
    expect(m.kind).toBe('unionRows');
    expect(m.unionMembers?.[0]).toMatch(/\(\): string/);
    expect(m.unionMembers?.[1]).toMatch(/number/);
  });
});
