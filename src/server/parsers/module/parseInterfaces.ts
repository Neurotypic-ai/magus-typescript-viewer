import type { ASTNode } from 'jscodeshift';
import type { ParseResult } from '../ParseResult';
import type { ModuleParserContext } from './types';
import { getHeritageClauseName } from './astUtils';
import { parseMethods, parseProperties } from './parseMembersShared';
import { generateInterfaceUUID } from '../../utils/uuid';

export function parseInterfaces(ctx: ModuleParserContext, result: ParseResult): void {
  ctx.root.find(ctx.j.TSInterfaceDeclaration).forEach((path) => {
    const node = path.node;
    if (node.id.type !== 'Identifier' || !node.id.name) return;

    const interfaceId = generateInterfaceUUID(ctx.packageId, ctx.moduleId, node.id.name);

    result.interfaces.push({
      id: interfaceId,
      package_id: ctx.packageId,
      module_id: ctx.moduleId,
      name: node.id.name,
    });

    // Extract extends relationships (deferred name-based resolution)
    if (node.extends && Array.isArray(node.extends)) {
      for (const ext of node.extends) {
        const name = getHeritageClauseName(ext as ASTNode);
        if (name) {
          result.interfaceExtends.push({ interfaceId, parentName: name });
        }
      }
    }

    // Parse methods and properties
    const parentName = 'name' in node.id && typeof node.id.name === 'string' ? node.id.name : undefined;

    try {
      const methods = parseMethods(ctx, ctx.j(node), 'interface', interfaceId, result, parentName);
      result.methods.push(...methods);
    } catch (error: unknown) {
      ctx.logger.error(`Error parsing interface methods: ${String(error)}`);
    }

    try {
      const properties = parseProperties(ctx, ctx.moduleId, interfaceId, 'interface', node);
      result.properties.push(...properties);
    } catch (error: unknown) {
      ctx.logger.error(`Error parsing interface properties: ${String(error)}`);
    }
  });
}
