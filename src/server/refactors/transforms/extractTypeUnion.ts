import type {
  ASTPath,
  ClassBody,
  ClassProperty,
  Collection,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  JSCodeshift,
  TSInterfaceBody,
  TSPropertySignature,
  TSUnionType,
} from 'jscodeshift';
import type { Transform } from '../Transform';

interface ExtractTypeUnionContext {
  [key: string]: unknown;
  suggestedName: string;
  parentName: string;
  parentType: 'class' | 'interface';
  propertyName: string;
}

type ExportDeclaration = ExportNamedDeclaration | ExportDefaultDeclaration;

type AnnotationNode = { typeAnnotation?: { type?: string } | undefined } | null | undefined;

function isExtractContext(context: Record<string, unknown>): context is ExtractTypeUnionContext {
  return (
    typeof context['suggestedName'] === 'string' &&
    typeof context['parentName'] === 'string' &&
    typeof context['parentType'] === 'string' &&
    typeof context['propertyName'] === 'string'
  );
}

function getExportInfo(path: ASTPath): { exported: boolean; kind: 'named' | 'default' | null } {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parentPath = path.parentPath;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const parentType = parentPath?.value?.type as string | undefined;

  if (parentType === 'ExportNamedDeclaration') {
    return { exported: true, kind: 'named' };
  }
  if (parentType === 'ExportDefaultDeclaration') {
    return { exported: true, kind: 'default' };
  }
  return { exported: false, kind: null };
}

function extractUnionFromAnnotation(
  typeAnnotation: AnnotationNode,
  propertyName: string,
  parentName: string,
  parentLabel: string,
): TSUnionType {
  const innerType = typeAnnotation?.typeAnnotation;
  if (innerType?.type !== 'TSUnionType') {
    throw new Error(`Property '${propertyName}' does not have a union type annotation on ${parentLabel} '${parentName}'`);
  }
  return innerType as TSUnionType;
}

function findProperty(
  body: TSInterfaceBody | ClassBody,
  memberTypes: readonly string[],
  propertyName: string,
  parentName: string,
  parentLabel: string,
): TSPropertySignature | ClassProperty {
  for (const member of body.body) {
    if (!memberTypes.includes(member.type)) continue;
    const key = (member as TSPropertySignature | ClassProperty).key;
    if (key.type === 'Identifier' && key.name === propertyName) {
      return member as TSPropertySignature | ClassProperty;
    }
  }
  throw new Error(`Property '${propertyName}' not found on ${parentLabel} '${parentName}'`);
}

function findSingleDeclaration(
  results: Collection,
  parentName: string,
  parentLabel: string,
): ASTPath {
  if (results.length === 0) {
    throw new Error(`${parentLabel} '${parentName}' not found`);
  }
  if (results.length > 1) {
    throw new Error(`Multiple declarations of ${parentLabel} '${parentName}' found — cannot determine which to transform`);
  }
  return results.paths()[0] as ASTPath;
}

function checkNameConflict(j: JSCodeshift, root: Collection, suggestedName: string): void {
  const hasTypeAlias = root.find(j.TSTypeAliasDeclaration, { id: { name: suggestedName } }).length > 0;
  const hasInterface = root.find(j.TSInterfaceDeclaration, { id: { name: suggestedName } }).length > 0;
  const hasClass = root.find(j.ClassDeclaration, { id: { name: suggestedName } }).length > 0;
  const hasEnum = root.find(j.TSEnumDeclaration, { id: { name: suggestedName } }).length > 0;
  const hasFunction = root.find(j.FunctionDeclaration, { id: { name: suggestedName } }).length > 0;
  const hasVariable = root.find(j.VariableDeclarator, { id: { type: 'Identifier', name: suggestedName } }).length > 0;
  const hasImportNamed = root.find(j.ImportSpecifier, { local: { name: suggestedName } }).length > 0;
  const hasImportDefault = root.find(j.ImportDefaultSpecifier, { local: { name: suggestedName } }).length > 0;
  const hasImportNamespace = root.find(j.ImportNamespaceSpecifier, { local: { name: suggestedName } }).length > 0;

  if (
    hasTypeAlias ||
    hasInterface ||
    hasClass ||
    hasEnum ||
    hasFunction ||
    hasVariable ||
    hasImportNamed ||
    hasImportDefault ||
    hasImportNamespace
  ) {
    throw new Error(`Type alias '${suggestedName}' already exists in this file scope — choose a different name`);
  }
}

function insertTypeAlias(
  j: JSCodeshift,
  path: ASTPath,
  suggestedName: string,
  unionType: TSUnionType,
): void {
  const { exported, kind } = getExportInfo(path);
  const typeAlias = j.tsTypeAliasDeclaration(j.identifier(suggestedName), unionType);
  const insertTarget = exported ? path.parentPath as ASTPath<ExportDeclaration> : path;

  // For named exports, also export the type alias. For default exports,
  // the type alias is a separate declaration and should not be default-exported.
  if (exported && kind === 'named') {
    insertTarget.insertBefore(j.exportNamedDeclaration(typeAlias));
  } else {
    insertTarget.insertBefore(typeAlias);
  }
}

export const extractTypeUnion: Transform = {
  action: 'extract-type-union',
  name: 'Extract Type Union',
  description: 'Extracts an inline union type from a property into a named type alias.',

  execute(j, root, _source, context) {
    if (!isExtractContext(context)) {
      throw new Error('Invalid context for extract-type-union transform');
    }

    const { suggestedName, parentName, parentType, propertyName } = context;

    const isIface = parentType === 'interface';
    const memberTypes = isIface
      ? ['TSPropertySignature']
      : ['ClassProperty', 'PropertyDefinition'];
    const label = isIface ? 'Interface' : 'Class';
    const lowerLabel = isIface ? 'interface' : 'class';

    const results = isIface
      ? root.find(j.TSInterfaceDeclaration, { id: { name: parentName } })
      : root.find(j.ClassDeclaration, { id: { name: parentName } });

    const declPath = findSingleDeclaration(results as Collection, parentName, label);

    checkNameConflict(j, root, suggestedName);

    const body = (declPath.value as { body: TSInterfaceBody | ClassBody }).body;
    const targetProp = findProperty(body, memberTypes, propertyName, parentName, lowerLabel);
    const unionType = extractUnionFromAnnotation(
      targetProp.typeAnnotation as AnnotationNode, propertyName, parentName, lowerLabel,
    );

    targetProp.typeAnnotation = j.tsTypeAnnotation(j.tsTypeReference(j.identifier(suggestedName)));
    insertTypeAlias(j, declPath, suggestedName, unionType);

    return root.toSource();
  },
};
