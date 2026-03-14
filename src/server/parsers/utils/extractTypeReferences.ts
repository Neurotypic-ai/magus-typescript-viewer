/**
 * Utilities for extracting user-defined type references from type annotation strings.
 *
 * This enables tracking relationships like "property X has type Y" where Y is a
 * user-defined type (class, interface, type alias, enum) rather than a primitive
 * or built-in type.
 */

/** Primitive types that should not be tracked as type references */
const PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'undefined',
  'null',
  'never',
  'unknown',
  'any',
  'object',
  'symbol',
  'bigint',
]);

/** Built-in utility and global types */
const BUILTIN_TYPES = new Set([
  'Array',
  'Map',
  'Set',
  'Promise',
  'Record',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'ReturnType',
  'Parameters',
  'InstanceType',
  'ConstructorParameters',
  'Awaited',
  'Iterable',
  'Iterator',
  'AsyncIterable',
  'AsyncIterator',
  'Generator',
  'AsyncGenerator',
  'ReadonlyArray',
  'ReadonlyMap',
  'ReadonlySet',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'Buffer',
]);

/**
 * Represents a type reference found in a type annotation.
 */
export interface TypeReference {
  /** The referenced type name (e.g., 'User', 'Item') */
  typeName: string;
  /** Where this reference appears */
  context: 'property_type' | 'parameter_type' | 'return_type' | 'generic_argument';
  /** The source entity ID that has this type reference */
  sourceId: string;
  /** The source entity kind */
  sourceKind: 'property' | 'method' | 'parameter';
}

/**
 * Extract user-defined type names from a type annotation string.
 * Filters out primitives and built-in types.
 *
 * Finds all capitalized identifiers (starting with uppercase A-Z) that are not
 * primitive types or well-known built-in types.
 *
 * @example
 * ```ts
 * extractTypeNames('User')                    // ['User']
 * extractTypeNames('Map<string, Item>')        // ['Item']  (Map is built-in)
 * extractTypeNames('(arg: Foo) => Bar')        // ['Foo', 'Bar']
 * extractTypeNames('string')                   // []
 * extractTypeNames('string | null')            // []
 * extractTypeNames('Array<UserDTO>')           // ['UserDTO']
 * extractTypeNames('Record<string, Config>')   // ['Config']
 * ```
 */
export function extractTypeNames(typeString: string): string[] {
  if (!typeString) {
    return [];
  }

  // Match capitalized identifiers: start with uppercase letter, followed by alphanumerics
  const identifierPattern = /\b([A-Z][a-zA-Z0-9]*)\b/g;
  const matches = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = identifierPattern.exec(typeString)) !== null) {
    const name = match[1];
    if (!PRIMITIVE_TYPES.has(name) && !BUILTIN_TYPES.has(name)) {
      matches.add(name);
    }
  }

  return [...matches];
}

/**
 * Build a TypeReference from extracted type name information.
 *
 * This is a convenience factory for creating TypeReference objects from the
 * results of `extractTypeNames`.
 */
export function buildTypeReference(
  typeName: string,
  context: TypeReference['context'],
  sourceId: string,
  sourceKind: TypeReference['sourceKind']
): TypeReference {
  return { typeName, context, sourceId, sourceKind };
}
