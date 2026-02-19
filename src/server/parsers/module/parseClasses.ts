import type { ASTNode } from 'jscodeshift';
import type { ParseResult } from '../ParseResult';
import type { ModuleParserContext } from './types';
import { getIdentifierName, getHeritageClauseName } from './astUtils';
import { parseMethods, parseProperties } from './parseMembersShared';
import { generateClassUUID } from '../../utils/uuid';

export function parseClasses(ctx: ModuleParserContext, result: ParseResult): void {
  ctx.root.find(ctx.j.ClassDeclaration).forEach((path) => {
    const node = path.node;
    if (!node.id?.name) return;

    const className = getIdentifierName(node.id);
    if (!className) return;

    const classId = generateClassUUID(ctx.packageId, ctx.moduleId, className);

    // Inline createClassDTO — it was just an object literal
    if (node.id.type !== 'Identifier') {
      throw new Error('Invalid class declaration: missing identifier');
    }
    result.classes.push({
      id: classId,
      package_id: ctx.packageId,
      module_id: ctx.moduleId,
      name: node.id.name,
    });

    // Extract extends relationship (deferred name-based resolution)
    if (node.superClass?.type === 'Identifier' && node.superClass.name) {
      result.classExtends.push({
        classId,
        parentName: node.superClass.name,
      });
    }

    // Extract implements relationships (deferred name-based resolution)
    if (node.implements && Array.isArray(node.implements)) {
      for (const impl of node.implements) {
        const name = getHeritageClauseName(impl as ASTNode);
        if (name) {
          result.classImplements.push({ classId, interfaceName: name });
        }
      }
    }

    // Parse methods and properties
    const parentName =
      typeof node.id === 'object' && 'name' in node.id && typeof node.id.name === 'string'
        ? node.id.name
        : undefined;

    try {
      const methods = parseMethods(ctx, ctx.j(node), 'class', classId, result, parentName);
      result.methods.push(...methods);
    } catch (error: unknown) {
      ctx.logger.error(`Error parsing class methods: ${String(error)}`);
    }

    try {
      const properties = parseProperties(ctx, ctx.moduleId, classId, 'class', node);
      result.properties.push(...properties);
    } catch (error: unknown) {
      ctx.logger.error(`Error parsing class properties: ${String(error)}`);
    }
  });
}
