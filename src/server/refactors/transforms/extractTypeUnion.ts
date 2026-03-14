import type {
  ASTPath,
  ClassBody,
  ClassDeclaration,
  ClassProperty,
  Collection,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  JSCodeshift,
  TSInterfaceBody,
  TSInterfaceDeclaration,
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

function isExtractContext(context: Record<string, unknown>): context is ExtractTypeUnionContext {
  return (
    typeof context['suggestedName'] === 'string' &&
    typeof context['parentName'] === 'string' &&
    typeof context['parentType'] === 'string' &&
    typeof context['propertyName'] === 'string'
  );
}

type ExportDeclaration = ExportNamedDeclaration | ExportDefaultDeclaration;

function isExportedDeclaration(path: ASTPath): { exported: boolean; kind: 'named' | 'default' | null } {
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

function getInsertTarget(path: ASTPath, exported: boolean): ASTPath {
  if (exported) {
    return path.parentPath as ASTPath<ExportDeclaration>;
  }
  return path;
}

function extractUnionFromAnnotation(
  typeAnnotation: { typeAnnotation?: { type?: string } | undefined } | null | undefined,
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

function findProperty<T extends TSPropertySignature | ClassProperty>(
  body: TSInterfaceBody | ClassBody,
  memberType: string,
  propertyName: string,
  parentName: string,
  parentLabel: string,
): T {
  for (const member of body.body) {
    if (member.type !== memberType) continue;
    const key = (member as TSPropertySignature | ClassProperty).key;
    if (key.type === 'Identifier' && key.name === propertyName) {
      return member as T;
    }
  }
  throw new Error(`Property '${propertyName}' not found on ${parentLabel} '${parentName}'`);
}

function findSingleDeclaration<T>(
  results: Collection<T>,
  parentName: string,
  parentLabel: string,
): ASTPath<T> {
  if (results.length === 0) {
    throw new Error(`${parentLabel} '${parentName}' not found`);
  }
  if (results.length > 1) {
    throw new Error(`Multiple declarations of ${parentLabel} '${parentName}' found — cannot determine which to transform`);
  }
  return results.paths()[0] as ASTPath<T>;
}

function checkNameConflict(j: JSCodeshift, root: Collection, suggestedName: string): void {
  const existingAliases = root.find(j.TSTypeAliasDeclaration, { id: { name: suggestedName } });
  if (existingAliases.length > 0) {
    throw new Error(`Type alias '${suggestedName}' already exists in this file — choose a different name`);
  }
}

function insertTypeAlias(
  j: JSCodeshift,
  path: ASTPath,
  suggestedName: string,
  unionType: TSUnionType,
): void {
  const { exported, kind } = isExportedDeclaration(path);

  const typeAlias = j.tsTypeAliasDeclaration(
    j.identifier(suggestedName),
    unionType,
  );

  const insertTarget = getInsertTarget(path, exported);

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

    checkNameConflict(j, root, suggestedName);

    if (parentType === 'interface') {
      const results = root.find(j.TSInterfaceDeclaration, { id: { name: parentName } });
      const ifacePath = findSingleDeclaration<TSInterfaceDeclaration>(results, parentName, 'Interface');
      const body = ifacePath.value.body;

      const targetProp = findProperty<TSPropertySignature>(
        body, 'TSPropertySignature', propertyName, parentName, 'interface',
      );

      const unionType = extractUnionFromAnnotation(
        targetProp.typeAnnotation, propertyName, parentName, 'interface',
      );

      targetProp.typeAnnotation = j.tsTypeAnnotation(
        j.tsTypeReference(j.identifier(suggestedName)),
      );

      insertTypeAlias(j, ifacePath, suggestedName, unionType);
    } else {
      const results = root.find(j.ClassDeclaration, { id: { name: parentName } });
      const classPath = findSingleDeclaration<ClassDeclaration>(results, parentName, 'Class');
      const body = classPath.value.body;

      const targetProp = findProperty<ClassProperty>(
        body, 'ClassProperty', propertyName, parentName, 'class',
      );

      const unionType = extractUnionFromAnnotation(
        targetProp.typeAnnotation as { typeAnnotation?: { type?: string } | undefined } | null | undefined,
        propertyName, parentName, 'class',
      );

      targetProp.typeAnnotation = j.tsTypeAnnotation(
        j.tsTypeReference(j.identifier(suggestedName)),
      );

      insertTypeAlias(j, classPath, suggestedName, unionType);
    }

    return root.toSource();
  },
};
