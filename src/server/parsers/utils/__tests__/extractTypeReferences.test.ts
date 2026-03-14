import { describe, it, expect } from 'vitest';
import { extractTypeNames, buildTypeReference } from '../extractTypeReferences';
import type { TypeReference } from '../extractTypeReferences';

describe('extractTypeNames', () => {
  // -------------------------------------------------------------------------
  // Basic cases
  // -------------------------------------------------------------------------

  it('should extract a single user-defined type', () => {
    expect(extractTypeNames('User')).toEqual(['User']);
  });

  it('should return empty array for primitive types', () => {
    expect(extractTypeNames('string')).toEqual([]);
    expect(extractTypeNames('number')).toEqual([]);
    expect(extractTypeNames('boolean')).toEqual([]);
    expect(extractTypeNames('void')).toEqual([]);
    expect(extractTypeNames('undefined')).toEqual([]);
    expect(extractTypeNames('null')).toEqual([]);
    expect(extractTypeNames('never')).toEqual([]);
    expect(extractTypeNames('unknown')).toEqual([]);
    expect(extractTypeNames('any')).toEqual([]);
    expect(extractTypeNames('object')).toEqual([]);
    expect(extractTypeNames('symbol')).toEqual([]);
    expect(extractTypeNames('bigint')).toEqual([]);
  });

  it('should return empty array for empty or falsy input', () => {
    expect(extractTypeNames('')).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Built-in types
  // -------------------------------------------------------------------------

  it('should filter out built-in utility types', () => {
    expect(extractTypeNames('Array')).toEqual([]);
    expect(extractTypeNames('Map')).toEqual([]);
    expect(extractTypeNames('Set')).toEqual([]);
    expect(extractTypeNames('Promise')).toEqual([]);
    expect(extractTypeNames('Record')).toEqual([]);
    expect(extractTypeNames('Partial')).toEqual([]);
    expect(extractTypeNames('Date')).toEqual([]);
    expect(extractTypeNames('RegExp')).toEqual([]);
    expect(extractTypeNames('Error')).toEqual([]);
    expect(extractTypeNames('Buffer')).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Generic type arguments
  // -------------------------------------------------------------------------

  it('should extract user-defined types from generic arguments', () => {
    expect(extractTypeNames('Map<string, Item>')).toEqual(['Item']);
  });

  it('should extract from Array generic', () => {
    expect(extractTypeNames('Array<UserDTO>')).toEqual(['UserDTO']);
  });

  it('should extract from Record with user-defined value type', () => {
    expect(extractTypeNames('Record<string, Config>')).toEqual(['Config']);
  });

  it('should extract from Promise with user-defined type', () => {
    expect(extractTypeNames('Promise<ApiResponse>')).toEqual(['ApiResponse']);
  });

  it('should extract multiple user-defined types from nested generics', () => {
    const result = extractTypeNames('Map<UserId, Promise<UserProfile>>');
    expect(result).toContain('UserId');
    expect(result).toContain('UserProfile');
    expect(result).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Union and intersection types
  // -------------------------------------------------------------------------

  it('should extract from union types', () => {
    const result = extractTypeNames('User | Admin');
    expect(result).toContain('User');
    expect(result).toContain('Admin');
    expect(result).toHaveLength(2);
  });

  it('should extract from intersection types', () => {
    const result = extractTypeNames('User & Serializable');
    expect(result).toContain('User');
    expect(result).toContain('Serializable');
    expect(result).toHaveLength(2);
  });

  it('should handle union with primitives', () => {
    expect(extractTypeNames('string | null')).toEqual([]);
    expect(extractTypeNames('User | null')).toEqual(['User']);
    expect(extractTypeNames('string | User | undefined')).toEqual(['User']);
  });

  // -------------------------------------------------------------------------
  // Function types
  // -------------------------------------------------------------------------

  it('should extract from function parameter and return types', () => {
    const result = extractTypeNames('(arg: Foo) => Bar');
    expect(result).toContain('Foo');
    expect(result).toContain('Bar');
    expect(result).toHaveLength(2);
  });

  it('should extract from multi-parameter function types', () => {
    const result = extractTypeNames('(user: User, config: Config) => Result');
    expect(result).toContain('User');
    expect(result).toContain('Config');
    expect(result).toContain('Result');
    expect(result).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Tuple types
  // -------------------------------------------------------------------------

  it('should extract from tuple types', () => {
    const result = extractTypeNames('[User, string, Config]');
    expect(result).toContain('User');
    expect(result).toContain('Config');
    expect(result).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  it('should deduplicate repeated type names', () => {
    const result = extractTypeNames('Map<User, User>');
    expect(result).toEqual(['User']);
  });

  it('should deduplicate across union members', () => {
    const result = extractTypeNames('User | User | Admin');
    expect(result).toContain('User');
    expect(result).toContain('Admin');
    expect(result).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Complex real-world types
  // -------------------------------------------------------------------------

  it('should handle complex nested types', () => {
    const result = extractTypeNames('Partial<Pick<UserProfile, "name" | "email">>');
    expect(result).toEqual(['UserProfile']);
  });

  it('should handle type with array syntax', () => {
    expect(extractTypeNames('User[]')).toEqual(['User']);
  });

  it('should handle readonly array type', () => {
    expect(extractTypeNames('readonly User[]')).toEqual(['User']);
  });

  it('should not match lowercase identifiers', () => {
    // lowercase identifiers are not user-defined types by our heuristic
    expect(extractTypeNames('myType')).toEqual([]);
  });
});

describe('buildTypeReference', () => {
  it('should create a TypeReference object', () => {
    const ref: TypeReference = buildTypeReference('User', 'property_type', 'prop-uuid-123', 'property');
    expect(ref).toEqual({
      typeName: 'User',
      context: 'property_type',
      sourceId: 'prop-uuid-123',
      sourceKind: 'property',
    });
  });

  it('should create a TypeReference for a parameter', () => {
    const ref: TypeReference = buildTypeReference('Config', 'parameter_type', 'param-uuid-456', 'parameter');
    expect(ref).toEqual({
      typeName: 'Config',
      context: 'parameter_type',
      sourceId: 'param-uuid-456',
      sourceKind: 'parameter',
    });
  });

  it('should create a TypeReference for a return type', () => {
    const ref: TypeReference = buildTypeReference('Result', 'return_type', 'method-uuid-789', 'method');
    expect(ref).toEqual({
      typeName: 'Result',
      context: 'return_type',
      sourceId: 'method-uuid-789',
      sourceKind: 'method',
    });
  });
});
