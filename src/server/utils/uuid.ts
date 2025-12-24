import { v5 as uuidv5 } from 'uuid';

/**
 * UUID v5 namespaces for each entity type in the typescript viewer project
 */
const NAMESPACES = {
  class: '4e6f2fef-86d8-4313-92ae-11fc409b68b4',
  interface: 'e7658749-0c84-4f31-b534-15d95d45cf83',
  package: '58532622-6b61-4607-bb0c-ff8cb5364979',
  method: 'b507c1b4-e66e-42e9-81b7-39351a124fe1',
  property: 'f06da354-f4f6-4ef1-8d0d-a17662964712',
  parameter: 'fa4c32fe-43fd-4fb5-a994-9f2d68e72803',
  module: 'a4205160-cef7-471d-a459-24b993d8c0d8',
  enum: '1d6acd05-a181-41bf-be83-b0be97efe3c9',
  function: 'd9f8e2b3-7c4a-4d1e-9f6a-5c3b8d2a1e4f',
  export: '33c9c31d-ccfa-47b8-8966-0bb08c51fc45',
  import: 'b9a7d20b-45ff-47a4-8eab-42cf921be416',
  typeAlias: '27473cf4-2ac7-477c-a903-01693f9bcf67',
  moduleDefinition: 'e481a0e5-fac9-4ec1-bd87-7f871c807db5',
} as const;

/**
 * Generate a deterministic UUID v5 for a given entity type and key.
 * The key should be a concatenation of all context-relevant identifiers.
 *
 * @param type - The type of entity (must be a key of NAMESPACES)
 * @param key - The unique key built from context-specific properties
 * @returns A deterministic UUID v5
 */
export function generateUUID(type: keyof typeof NAMESPACES, key: string): string {
  return uuidv5(key, NAMESPACES[type]);
}

// Updated UUID generators with added context

export const generateClassUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('class', `${packageId}.${moduleId}.${name}`);

export const generateInterfaceUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('interface', `${packageId}.${moduleId}.${name}`);

export const generatePackageUUID = (name: string, version: string): string =>
  generateUUID('package', `${name}@${version}`);

export const generateMethodUUID = (packageId: string, moduleId: string, parentId: string, name: string): string =>
  generateUUID('method', `${packageId}.${moduleId}.${parentId}.${name}`);

export const generatePropertyUUID = (
  packageId: string,
  moduleId: string,
  parentId: string,
  name: string,
  parentType: 'class' | 'interface'
): string => generateUUID('property', `${packageId}.${moduleId}.${parentId}.${parentType}.${name}`);

export const generateParameterUUID = (methodId: string, name: string): string =>
  generateUUID('parameter', `${methodId}.${name}`);

export const generateModuleUUID = (packageId: string, modulePath: string): string =>
  generateUUID('module', `${packageId}.${modulePath}`);

export const generateEnumUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('enum', `${packageId}.${moduleId}.${name}`);

export const generateExportUUID = (moduleId: string, exportName: string): string =>
  generateUUID('export', `${moduleId}.${exportName}`);

export const generateImportUUID = (moduleId: string, importName: string): string =>
  generateUUID('import', `${moduleId}.${importName}`);

export const generateTypeAliasUUID = (moduleId: string, name: string): string =>
  generateUUID('typeAlias', `${moduleId}.${name}`);

export const generateModuleDefinitionUUID = (moduleId: string, name: string): string =>
  generateUUID('moduleDefinition', `${moduleId}.${name}`);

export const generateFunctionUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('function', `${packageId}.${moduleId}.${name}`);
