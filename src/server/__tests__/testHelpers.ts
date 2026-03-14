import type { ParseResult } from '../parsers/ParseResult';

/** Minimal empty ParseResult for tests that don't need real data. */
export function emptyParseResult(overrides?: Partial<ParseResult>): ParseResult {
  return {
    modules: [],
    classes: [],
    interfaces: [],
    functions: [],
    typeAliases: [],
    enums: [],
    variables: [],
    methods: [],
    properties: [],
    parameters: [],
    imports: [],
    exports: [],
    classExtends: [],
    classImplements: [],
    interfaceExtends: [],
    symbolUsages: [],
    symbolReferences: [],
    ...overrides,
  };
}
