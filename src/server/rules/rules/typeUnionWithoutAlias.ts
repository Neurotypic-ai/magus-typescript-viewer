import { generateCodeIssueUUID } from '../../utils/uuid';

import type {
  ASTPath,
  ClassDeclaration,
  ClassProperty,
  TSInterfaceDeclaration,
  TSPropertySignature,
  TSTypeAnnotation,
  TSUnionType,
} from 'jscodeshift';
import type { IClassCreateDTO } from '../../db/repositories/ClassRepository';
import type { IInterfaceCreateDTO } from '../../db/repositories/InterfaceRepository';
import type { IPropertyCreateDTO } from '../../db/repositories/PropertyRepository';
import type { CodeIssue, Rule, RuleContext } from '../Rule';

function toPascalCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

function getUnionMemberTexts(union: TSUnionType, source: string): string[] {
  return union.types.map((member) => {
    if (member.start != null && member.end != null) {
      return source.slice(member.start, member.end);
    }
    return '(unknown)';
  });
}

function findPropertyDTO(
  context: RuleContext,
  parentId: string,
  propertyName: string,
  parentType: 'class' | 'interface'
): IPropertyCreateDTO | undefined {
  return context.parseResult.properties.find(
    (p) =>
      p.module_id === context.moduleId &&
      p.parent_id === parentId &&
      p.parent_type === parentType &&
      p.name === propertyName
  );
}

function findClassDTO(context: RuleContext, name: string): IClassCreateDTO | undefined {
  return context.parseResult.classes.find(
    (c) => c.module_id === context.moduleId && c.name === name
  );
}

function findInterfaceDTO(context: RuleContext, name: string): IInterfaceCreateDTO | undefined {
  return context.parseResult.interfaces.find(
    (i) => i.module_id === context.moduleId && i.name === name
  );
}

function checkUnionProperty(
  context: RuleContext,
  propertyName: string,
  typeAnnotation: TSTypeAnnotation | undefined,
  parentName: string,
  parentId: string,
  parentType: 'class' | 'interface',
  loc: { line: number; column: number } | undefined
): CodeIssue | undefined {
  if (!typeAnnotation) return undefined;

  const annotation = typeAnnotation.typeAnnotation;
  if (!annotation || annotation.type !== 'TSUnionType') return undefined;

  const union = annotation as TSUnionType;
  const threshold = context.config.typeUnionWithoutAlias.memberThreshold;

  if (union.types.length < threshold) return undefined;

  const memberTexts = getUnionMemberTexts(union, context.sourceContent);
  const suggestedName = `${parentName}${toPascalCase(propertyName)}`;

  const propertyDTO = findPropertyDTO(context, parentId, propertyName, parentType);

  const issueId = generateCodeIssueUUID(
    context.moduleId,
    'type-union-without-alias',
    `${parentName}.${propertyName}`
  );

  return {
    id: issueId,
    rule_code: 'type-union-without-alias',
    severity: 'warning',
    message: `Property '${propertyName}' on ${parentType} '${parentName}' has an inline union type with ${union.types.length} members that should be extracted to a named type alias.`,
    suggestion: `Extract to type alias '${suggestedName}'`,
    package_id: context.packageId,
    module_id: context.moduleId,
    file_path: context.filePath,
    entity_id: propertyDTO?.id,
    entity_type: 'property',
    entity_name: propertyName,
    parent_entity_id: parentId,
    parent_entity_type: parentType,
    parent_entity_name: parentName,
    property_name: propertyName,
    line: loc?.line,
    column: loc?.column,
    refactor_action: 'extract-type-union',
    refactor_context: {
      suggestedName,
      parentName,
      parentType,
      propertyName,
      unionMembers: memberTexts,
    },
  };
}

export const typeUnionWithoutAlias: Rule = {
  code: 'type-union-without-alias',
  name: 'Type Union Without Type Alias',
  description: 'Detects inline union types on properties that should be extracted to named type aliases.',
  severity: 'warning',

  check(context: RuleContext): CodeIssue[] {
    const issues: CodeIssue[] = [];

    // Check interface properties
    context.root.find(context.j.TSInterfaceDeclaration).forEach((path: ASTPath<TSInterfaceDeclaration>) => {
      const node = path.value;
      const interfaceName = node.id.name;
      const interfaceDTO = findInterfaceDTO(context, interfaceName);
      if (!interfaceDTO) return;

      const body = node.body;
      if (!body || !body.body) return;

      for (const member of body.body) {
        if (member.type !== 'TSPropertySignature') continue;
        const prop = member as TSPropertySignature;
        const key = prop.key;
        if (key.type !== 'Identifier') continue;

        const issue = checkUnionProperty(
          context,
          key.name,
          prop.typeAnnotation as TSTypeAnnotation | undefined,
          interfaceName,
          interfaceDTO.id,
          'interface',
          prop.loc?.start
        );
        if (issue) issues.push(issue);
      }
    });

    // Check class properties
    context.root.find(context.j.ClassDeclaration).forEach((path: ASTPath<ClassDeclaration>) => {
      const node = path.value;
      if (!node.id) return;
      const className = node.id.name;
      const classDTO = findClassDTO(context, className);
      if (!classDTO) return;

      const body = node.body;
      if (!body || !body.body) return;

      for (const member of body.body) {
        if (member.type !== 'ClassProperty') continue;
        const prop = member as ClassProperty;
        const key = prop.key;
        if (key.type !== 'Identifier') continue;

        const issue = checkUnionProperty(
          context,
          key.name,
          prop.typeAnnotation as TSTypeAnnotation | undefined,
          className,
          classDTO.id,
          'class',
          prop.loc?.start
        );
        if (issue) issues.push(issue);
      }
    });

    return issues;
  },
};
