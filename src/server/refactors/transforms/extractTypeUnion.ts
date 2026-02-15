import type {
  ASTPath,
  ClassDeclaration,
  ClassProperty,
  ExportNamedDeclaration,
  TSInterfaceDeclaration,
  TSPropertySignature,
} from 'jscodeshift';
import type { Transform } from '../Transform';

interface ExtractTypeUnionContext {
  [key: string]: unknown;
  suggestedName: string;
  parentName: string;
  parentType: 'class' | 'interface';
  propertyName: string;
  unionMembers: string[];
}

function isExtractContext(context: Record<string, unknown>): context is ExtractTypeUnionContext {
  return (
    typeof context['suggestedName'] === 'string' &&
    typeof context['parentName'] === 'string' &&
    typeof context['parentType'] === 'string' &&
    typeof context['propertyName'] === 'string' &&
    Array.isArray(context['unionMembers'])
  );
}

function isExportedDeclaration(path: ASTPath): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parentPath = path.parentPath;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return parentPath?.value?.type === 'ExportNamedDeclaration';
}

function getInsertTarget(path: ASTPath, isExported: boolean): ASTPath {
  if (isExported) {
    return path.parentPath as ASTPath<ExportNamedDeclaration>;
  }
  return path;
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

    if (parentType === 'interface') {
      const interfaces = root.find(j.TSInterfaceDeclaration, { id: { name: parentName } });
      if (interfaces.length === 0) {
        throw new Error(`Interface '${parentName}' not found`);
      }

      const ifacePath = interfaces.paths()[0] as ASTPath<TSInterfaceDeclaration>;
      const ifaceNode = ifacePath.value;
      const body = ifaceNode.body;

      // Find the target property
      let targetProp: TSPropertySignature | undefined;
      for (const member of body.body) {
        if (member.type !== 'TSPropertySignature') continue;
        if (member.key.type === 'Identifier' && member.key.name === propertyName) {
          targetProp = member;
          break;
        }
      }

      if (!targetProp) {
        throw new Error(`Property '${propertyName}' not found on interface '${parentName}'`);
      }

      const typeAnnotation = targetProp.typeAnnotation;
      const innerType = typeAnnotation?.typeAnnotation;
      if (innerType?.type !== 'TSUnionType') {
        throw new Error(`Property '${propertyName}' does not have a union type annotation`);
      }

      // Capture the union type before replacing (innerType is narrowed to TSUnionType)
      const unionType = innerType;

      // Replace property type with reference to new type alias
      targetProp.typeAnnotation = j.tsTypeAnnotation(
        j.tsTypeReference(j.identifier(suggestedName))
      );

      // Determine if the parent is exported
      const isExported = isExportedDeclaration(ifacePath);

      // Build the type alias declaration
      const typeAlias = j.tsTypeAliasDeclaration(
        j.identifier(suggestedName),
        unionType
      );

      // Insert before the parent declaration (or its export wrapper)
      const insertTarget = getInsertTarget(ifacePath, isExported);
      if (isExported) {
        const exportDecl = j.exportNamedDeclaration(typeAlias);
        insertTarget.insertBefore(exportDecl);
      } else {
        insertTarget.insertBefore(typeAlias);
      }
    } else {
      // Class property
      const classes = root.find(j.ClassDeclaration, { id: { name: parentName } });
      if (classes.length === 0) {
        throw new Error(`Class '${parentName}' not found`);
      }

      const classPath = classes.paths()[0] as ASTPath<ClassDeclaration>;
      const classNode = classPath.value;
      const body = classNode.body;

      let targetProp: ClassProperty | undefined;
      for (const member of body.body) {
        if (member.type !== 'ClassProperty') continue;
        if (member.key.type === 'Identifier' && member.key.name === propertyName) {
          targetProp = member;
          break;
        }
      }

      if (!targetProp) {
        throw new Error(`Property '${propertyName}' not found on class '${parentName}'`);
      }

      const typeAnnotation = targetProp.typeAnnotation;
      if (!typeAnnotation || (typeAnnotation as { typeAnnotation?: { type?: string } }).typeAnnotation?.type !== 'TSUnionType') {
        throw new Error(`Property '${propertyName}' does not have a union type annotation`);
      }

      const fullAnnotation = typeAnnotation as { typeAnnotation: { type: string } };
      const unionType = fullAnnotation.typeAnnotation;

      targetProp.typeAnnotation = j.tsTypeAnnotation(
        j.tsTypeReference(j.identifier(suggestedName))
      );

      const isExported = isExportedDeclaration(classPath);

      const typeAlias = j.tsTypeAliasDeclaration(
        j.identifier(suggestedName),
        unionType as Parameters<typeof j.tsTypeAliasDeclaration>[1]
      );

      const insertTarget = getInsertTarget(classPath, isExported);
      if (isExported) {
        const exportDecl = j.exportNamedDeclaration(typeAlias);
        insertTarget.insertBefore(exportDecl);
      } else {
        insertTarget.insertBefore(typeAlias);
      }
    }

    return root.toSource();
  },
};
