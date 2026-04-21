import { v5 as uuidv5 } from 'uuid';

import type { ParentType } from '../../shared/types/ParentType';

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
  variable: 'c8f3a1e7-5b2d-4a9c-b6e1-d4f7c2a8e3b5',
  moduleDefinition: 'e481a0e5-fac9-4ec1-bd87-7f871c807db5',
  codeIssue: 'a3b2c1d0-e4f5-6789-abcd-ef0123456789',
  analysisSnapshot: '2a5e91b6-8c7d-4f3e-a012-345678901234',
  entityMetric: '3b6f82c7-9d8e-5a4f-b123-456789012345',
  callEdge: '4c7f93d8-ae9f-6b5a-8234-567890123456',
  dependencyCycle: '5d80a4e9-bfa0-7c6b-9345-678901234567',
  duplicationCluster: '6e91b5fa-c0b1-5d7c-a456-789012345678',
  architecturalViolation: '7fa2c60b-d1c2-8e8d-b567-890123456789',
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
  parentType: ParentType
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

export const generateTypeAliasUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('typeAlias', `${packageId}.${moduleId}.${name}`);

export const generateVariableUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('variable', `${packageId}.${moduleId}.${name}`);

export const generateModuleDefinitionUUID = (moduleId: string, name: string): string =>
  generateUUID('moduleDefinition', `${moduleId}.${name}`);

export const generateFunctionUUID = (packageId: string, moduleId: string, name: string): string =>
  generateUUID('function', `${packageId}.${moduleId}.${name}`);

export const generateCodeIssueUUID = (moduleId: string, ruleCode: string, entityKey: string): string =>
  generateUUID('codeIssue', `${moduleId}:${ruleCode}:${entityKey}`);

/** Generate a deterministic UUID for a relationship record (junction table row) */
export const generateRelationshipUUID = (sourceId: string, targetId: string, type: string): string =>
  generateUUID('class', `rel:${type}:${sourceId}:${targetId}`);

/** Generate a deterministic UUID for an analysis snapshot. */
export const generateAnalysisSnapshotUUID = (packageId: string, createdAt: string): string =>
  generateUUID('analysisSnapshot', `${packageId}:${createdAt}`);

/** Generate a deterministic UUID for an entity metric row. */
export const generateEntityMetricUUID = (
  snapshotId: string,
  entityId: string,
  entityType: string,
  metricKey: string
): string => generateUUID('entityMetric', `${snapshotId}:${entityType}:${entityId}:${metricKey}`);

/** Generate a deterministic UUID for a call-graph edge. */
export const generateCallEdgeUUID = (
  sourceEntityId: string,
  targetName: string,
  callExpressionLine: number
): string => generateUUID('callEdge', `${sourceEntityId}:${targetName}:${String(callExpressionLine)}`);

/** Generate a deterministic UUID for a dependency cycle. */
export const generateDependencyCycleUUID = (packageId: string, participantsKey: string): string =>
  generateUUID('dependencyCycle', `${packageId}:${participantsKey}`);

/** Generate a deterministic UUID for a duplication cluster, keyed on its fingerprint. */
export const generateDuplicationClusterUUID = (packageId: string, fingerprint: string): string =>
  generateUUID('duplicationCluster', `${packageId}:${fingerprint}`);

/** Generate a deterministic UUID for an architectural violation record. */
export const generateArchitecturalViolationUUID = (
  snapshotId: string,
  ruleName: string,
  sourceModuleId: string,
  targetModuleId: string
): string =>
  generateUUID('architecturalViolation', `${snapshotId}:${ruleName}:${sourceModuleId}:${targetModuleId}`);
