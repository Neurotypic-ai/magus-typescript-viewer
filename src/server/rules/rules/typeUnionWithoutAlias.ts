import { getNodeProp } from '../../parsers/utils/astNodeAccess';
import { generateCodeIssueUUID } from '../../utils/uuid';

import type {
  ASTPath,
  ClassDeclaration,
  TSInterfaceDeclaration,
  TSUnionType,
} from 'jscodeshift';
import type { CodeIssue, Rule, RuleContext } from '../Rule';

function toPascalCase(str: string): string {
  if (!str) return '';
  const result = str
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
  return result || str;
}

function getUnionMemberTexts(union: TSUnionType, source: string): string[] {
  return union.types.map((member) => {
    const start = getNodeProp(member, 'start');
    const end = getNodeProp(member, 'end');
    if (typeof start === 'number' && typeof end === 'number' && start <= end && end <= source.length) {
      return source.slice(start, end);
    }
    return '(unknown)';
  });
}

interface PropertyTarget {
  name: string;
  parentName: string;
  parentId: string;
  parentType: 'class' | 'interface';
  loc?: { line: number; column: number } | undefined;
}

function checkUnionProperty(
  context: RuleContext,
  typeAnnotation: unknown,
  target: PropertyTarget
): CodeIssue | undefined {
  if (!typeAnnotation || typeof typeAnnotation !== 'object') return undefined;
  const annotation = getNodeProp(typeAnnotation, 'typeAnnotation');
  if (!annotation || typeof annotation !== 'object') return undefined;
  const annotationType = getNodeProp(annotation, 'type');
  if (annotationType !== 'TSUnionType') return undefined;
  const types = getNodeProp(annotation, 'types');
  if (!Array.isArray(types)) return undefined;

  const threshold = context.config.typeUnionWithoutAlias.memberThreshold;

  if (types.length < threshold) return undefined;

  const memberTexts = getUnionMemberTexts(annotation as TSUnionType, context.sourceContent);
  const suggestedName = `${target.parentName}${toPascalCase(target.name)}`;

  const propertyDTO = context.parseResult.properties.find(
    (p) =>
      p.module_id === context.moduleId &&
      p.parent_id === target.parentId &&
      p.parent_type === target.parentType &&
      p.name === target.name
  );

  const issueId = generateCodeIssueUUID(
    context.moduleId,
    'type-union-without-alias',
    `${target.parentType}:${target.parentName}.${target.name}`
  );

  const issue: CodeIssue = {
    id: issueId,
    rule_code: 'type-union-without-alias',
    severity: 'warning',
    message: `Property '${target.name}' on ${target.parentType} '${target.parentName}' has an inline union type with ${String(types.length)} members that should be extracted to a named type alias.`,
    suggestion: `Extract to type alias '${suggestedName}'`,
    package_id: context.packageId,
    module_id: context.moduleId,
    file_path: context.filePath,
    entity_type: 'property',
    entity_name: target.name,
    parent_entity_id: target.parentId,
    parent_entity_type: target.parentType,
    parent_entity_name: target.parentName,
    property_name: target.name,
    refactor_action: 'extract-type-union',
    refactor_context: {
      suggestedName,
      parentName: target.parentName,
      parentType: target.parentType,
      propertyName: target.name,
      unionMembers: memberTexts,
    },
  };

  if (propertyDTO) {
    issue.entity_id = propertyDTO.id;
  }
  if (target.loc) {
    issue.line = target.loc.line;
    issue.column = target.loc.column;
  }

  return issue;
}

export const typeUnionWithoutAlias: Rule = {
  code: 'type-union-without-alias',
  name: 'Type Union Without Type Alias',
  description: 'Detects inline union types on properties that should be extracted to named type aliases.',
  severity: 'warning',

  check(context: RuleContext): CodeIssue[] {
    const issues: CodeIssue[] = [];

    const interfacesByName = new Map(
      context.parseResult.interfaces
        .filter((i) => i.module_id === context.moduleId)
        .map((i) => [i.name, i] as const)
    );
    const classesByName = new Map(
      context.parseResult.classes
        .filter((c) => c.module_id === context.moduleId)
        .map((c) => [c.name, c] as const)
    );

    // Check interface properties
    context.root.find(context.j.TSInterfaceDeclaration).forEach((path: ASTPath<TSInterfaceDeclaration>) => {
      const node = path.value;
      if (node.id.type !== 'Identifier') return;
      const dto = interfacesByName.get(node.id.name);
      if (!dto) return;

      for (const member of node.body.body) {
        if (member.type !== 'TSPropertySignature') continue;
        if (member.key.type !== 'Identifier') continue;

        const issue = checkUnionProperty(context, member.typeAnnotation, {
          name: member.key.name,
          parentName: dto.name,
          parentId: dto.id,
          parentType: 'interface',
          loc: member.loc?.start,
        });
        if (issue) issues.push(issue);
      }
    });

    // Check class properties
    context.root.find(context.j.ClassDeclaration).forEach((path: ASTPath<ClassDeclaration>) => {
      const node = path.value;
      if (node.id?.type !== 'Identifier') return;
      const dto = classesByName.get(node.id.name);
      if (!dto) return;

      for (const member of node.body.body) {
        const memberType = member.type as string;
        if (memberType !== 'ClassProperty' && memberType !== 'PropertyDefinition') continue;
        const key = getNodeProp(member, 'key') as { type: string; name: string } | undefined;
        if (key?.type !== 'Identifier') continue;

        const issue = checkUnionProperty(context, getNodeProp(member, 'typeAnnotation'), {
          name: key.name,
          parentName: dto.name,
          parentId: dto.id,
          parentType: 'class',
          loc: member.loc?.start,
        });
        if (issue) issues.push(issue);
      }
    });

    return issues;
  },
};
