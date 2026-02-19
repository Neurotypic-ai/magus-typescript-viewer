import type { ASTNode, ASTPath, Identifier, JSCodeshift, TSTypeAnnotation, TSTypeParameter } from 'jscodeshift';
import type { ModuleParserContext } from './types';
import type { ParseResult, SymbolUsageRef } from '../ParseResult';
import type { IFunctionCreateDTO } from '../../db/repositories/FunctionRepository';
import type { ITypeAliasCreateDTO } from '../../db/repositories/TypeAliasRepository';
import type { IEnumCreateDTO } from '../../db/repositories/EnumRepository';
import type { IVariableCreateDTO } from '../../db/repositories/VariableRepository';
import { getIdentifierName, getTypeFromAnnotation, getReturnTypeFromNode } from './astUtils';
import { generateFunctionUUID, generateTypeAliasUUID, generateEnumUUID, generateVariableUUID } from '../../utils/uuid';

// ---------------------------------------------------------------------------
// File-private helper: extract symbol usages from a function/method body.
// This is intentionally duplicated (also lives in parseMembersShared.ts) to
// keep each sub-parser file self-contained and avoid circular dependencies.
// ---------------------------------------------------------------------------

function extractSymbolUsages(
  j: JSCodeshift,
  node: ASTNode,
  context: {
    moduleId: string;
    sourceSymbolId?: string | undefined;
    sourceSymbolType: 'method' | 'function';
    sourceSymbolName?: string | undefined;
    sourceParentName?: string | undefined;
    sourceParentType?: 'class' | 'interface' | undefined;
  }
): SymbolUsageRef[] {
  const usages: SymbolUsageRef[] = [];
  const seen = new Set<string>();

  j(node)
    .find(j.MemberExpression)
    .forEach((memberPath: ASTPath) => {
      const member = memberPath.node;
      if (member.type !== 'MemberExpression') return;

      let targetName: string | undefined;
      if (member.property.type === 'Identifier') {
        targetName = member.property.name;
      } else if ('value' in member.property && typeof member.property.value === 'string') {
        targetName = member.property.value;
      }
      if (!targetName) return;

      let qualifierName: string | undefined;
      if (member.object.type === 'Identifier') {
        qualifierName = member.object.name;
      } else if (member.object.type === 'ThisExpression') {
        qualifierName = 'this';
      }

      const isMethodCall = memberPath.name === 'callee';
      const targetKind = isMethodCall ? 'method' : 'property';

      const dedupeKey = `${targetKind}|${qualifierName ?? ''}|${targetName}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      usages.push({
        moduleId: context.moduleId,
        sourceSymbolId: context.sourceSymbolId,
        sourceSymbolType: context.sourceSymbolType,
        sourceSymbolName: context.sourceSymbolName,
        sourceParentName: context.sourceParentName,
        sourceParentType: context.sourceParentType,
        targetName,
        targetKind,
        qualifierName,
      });
    });

  return usages;
}

// ---------------------------------------------------------------------------
// 1. parseFunctions
// ---------------------------------------------------------------------------

/**
 * Parse module-level function declarations
 */
export function parseFunctions(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenFunctionIds = new Set<string>();

  const captureFunction = (node: ASTNode): void => {
    if (node.type !== 'FunctionDeclaration' || !node.id) return;

    const idName = getIdentifierName(node.id);
    if (!idName) return;

    const functionName = idName;

    // Only capture exported functions — this tool visualizes public API surface
    if (!exports.has(functionName)) return;

    const functionId = generateFunctionUUID(ctx.packageId, ctx.moduleId, functionName);
    if (seenFunctionIds.has(functionId)) {
      return;
    }
    seenFunctionIds.add(functionId);

    const hasExplicitReturnType = 'returnType' in node && node.returnType != null;
    const returnType = getReturnTypeFromNode(ctx.j, node, ctx.logger);

    const functionDTO: IFunctionCreateDTO = {
      id: functionId,
      package_id: ctx.packageId,
      module_id: ctx.moduleId,
      name: functionName,
      return_type: returnType,
      is_async: node.async ?? false,
      is_exported: true,
      has_explicit_return_type: hasExplicitReturnType,
    };

    result.functions.push(functionDTO);

    const usages = extractSymbolUsages(ctx.j, node, {
      moduleId: ctx.moduleId,
      sourceSymbolId: functionId,
      sourceSymbolType: 'function',
      sourceSymbolName: functionName,
    });
    if (usages.length > 0) {
      result.symbolUsages.push(...usages);
    }
  };

  ctx.root.find(ctx.j.Program).forEach((programPath: ASTPath) => {
    const programNode = programPath.node;
    if (programNode.type !== 'Program') {
      return;
    }

    programNode.body.forEach((statement) => {
      try {
        if (statement.type === 'FunctionDeclaration') {
          captureFunction(statement);
          return;
        }

        if (
          (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
          statement.declaration
        ) {
          captureFunction(statement.declaration as ASTNode);
        }
      } catch (error) {
        ctx.logger.error('Error parsing function:', error);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 2. parseTypeAliases
// ---------------------------------------------------------------------------

/**
 * Parse module-level type alias declarations (type Foo = ...)
 */
export function parseTypeAliases(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  const captureTypeAlias = (node: ASTNode): void => {
    if (node.type !== 'TSTypeAliasDeclaration') return;

    const idName = getIdentifierName(node.id);
    if (!idName) return;

    // Only capture exported type aliases — this tool visualizes public API surface
    if (!exports.has(idName)) return;

    const aliasId = generateTypeAliasUUID(ctx.packageId, ctx.moduleId, idName);
    if (seenIds.has(aliasId)) return;
    seenIds.add(aliasId);

    // Extract the type body as source text
    let typeBody = 'unknown';
    try {
      typeBody = ctx.j(node.typeAnnotation as ASTNode).toSource().replace(/[\n\s]+/g, ' ').trim() || 'unknown';
    } catch {
      typeBody = 'unknown';
    }

    // Extract type parameters
    let typeParametersJson: string | undefined;
    try {
      if ('typeParameters' in node && node.typeParameters) {
        const params = node.typeParameters as ASTNode;
        if ('params' in params && Array.isArray(params.params)) {
          const names = (params.params as TSTypeParameter[])
            .map((p) => getIdentifierName(p as unknown as Identifier))
            .filter((n): n is string => n !== null);
          if (names.length > 0) {
            typeParametersJson = JSON.stringify(names);
          }
        }
      }
    } catch {
      // ignore type parameter extraction failures
    }

    const dto: ITypeAliasCreateDTO = {
      id: aliasId,
      package_id: ctx.packageId,
      module_id: ctx.moduleId,
      name: idName,
      type: typeBody,
      type_parameters_json: typeParametersJson,
    };

    result.typeAliases.push(dto);
  };

  ctx.root.find(ctx.j.Program).forEach((programPath: ASTPath) => {
    const programNode = programPath.node;
    if (programNode.type !== 'Program') return;

    programNode.body.forEach((statement) => {
      try {
        if (statement.type === 'TSTypeAliasDeclaration') {
          captureTypeAlias(statement);
          return;
        }
        if (
          (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
          statement.declaration
        ) {
          captureTypeAlias(statement.declaration as ASTNode);
        }
      } catch (error) {
        ctx.logger.error('Error parsing type alias:', error);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 3. parseEnums
// ---------------------------------------------------------------------------

/**
 * Parse module-level enum declarations
 */
export function parseEnums(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  const captureEnum = (node: ASTNode): void => {
    if (node.type !== 'TSEnumDeclaration') return;

    const idName = getIdentifierName(node.id);
    if (!idName) return;

    // Only capture exported enums — this tool visualizes public API surface
    if (!exports.has(idName)) return;

    const enumId = generateEnumUUID(ctx.packageId, ctx.moduleId, idName);
    if (seenIds.has(enumId)) return;
    seenIds.add(enumId);

    // Extract member names
    let membersJson: string | undefined;
    try {
      if ('members' in node && Array.isArray(node.members)) {
        const memberNames = (node.members as ASTNode[])
          .map((m) => {
            if ('id' in m && m.id) {
              const mid = m.id as ASTNode;
              if (mid.type === 'Identifier' && 'name' in mid) {
                return mid.name;
              }
            }
            return null;
          })
          .filter((n): n is string => n !== null);
        if (memberNames.length > 0) {
          membersJson = JSON.stringify(memberNames);
        }
      }
    } catch {
      // ignore member extraction failures
    }

    const dto: IEnumCreateDTO = {
      id: enumId,
      package_id: ctx.packageId,
      module_id: ctx.moduleId,
      name: idName,
      members_json: membersJson,
    };

    result.enums.push(dto);
  };

  ctx.root.find(ctx.j.Program).forEach((programPath: ASTPath) => {
    const programNode = programPath.node;
    if (programNode.type !== 'Program') return;

    programNode.body.forEach((statement) => {
      try {
        if (statement.type === 'TSEnumDeclaration') {
          captureEnum(statement);
          return;
        }
        if (
          (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
          statement.declaration
        ) {
          captureEnum(statement.declaration as ASTNode);
        }
      } catch (error) {
        ctx.logger.error('Error parsing enum:', error);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 4. parseVariables
// ---------------------------------------------------------------------------

/**
 * Parse module-level variable declarations (const, let, var)
 */
export function parseVariables(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  const captureVariableDeclaration = (node: ASTNode): void => {
    if (node.type !== 'VariableDeclaration') return;

    const kind = (node as { kind: string }).kind as 'const' | 'let' | 'var';

    if (!('declarations' in node) || !Array.isArray(node.declarations)) return;

    for (const declarator of node.declarations as ASTNode[]) {
      try {
        if (!('id' in declarator) || !declarator.id) continue;

        const idNode = declarator.id as ASTNode;
        // Skip destructured patterns — only capture simple identifiers
        if (idNode.type !== 'Identifier') continue;

        const varName = getIdentifierName(idNode);
        if (!varName) continue;

        // Only capture exported variables — this tool visualizes public API surface
        if (!exports.has(varName)) continue;

        const varId = generateVariableUUID(ctx.packageId, ctx.moduleId, varName);
        if (seenIds.has(varId)) continue;
        seenIds.add(varId);

        // Extract type annotation
        let varType: string | undefined;
        if ('typeAnnotation' in idNode && idNode.typeAnnotation) {
          varType = getTypeFromAnnotation(ctx.j, idNode.typeAnnotation as TSTypeAnnotation, ctx.logger);
        }

        // Extract initializer source text (truncated to 500 chars)
        let initializer: string | undefined;
        try {
          if ('init' in declarator && declarator.init) {
            const initSource = ctx.j(declarator.init as ASTNode).toSource().replace(/[\n\s]+/g, ' ').trim();
            if (initSource) {
              initializer = initSource.length > 500 ? initSource.slice(0, 500) + '...' : initSource;
            }
          }
        } catch {
          // ignore initializer extraction failures
        }

        const dto: IVariableCreateDTO = {
          id: varId,
          package_id: ctx.packageId,
          module_id: ctx.moduleId,
          name: varName,
          kind,
          type: varType,
          initializer,
        };

        result.variables.push(dto);
      } catch (error) {
        ctx.logger.error('Error parsing variable declarator:', error);
      }
    }
  };

  ctx.root.find(ctx.j.Program).forEach((programPath: ASTPath) => {
    const programNode = programPath.node;
    if (programNode.type !== 'Program') return;

    programNode.body.forEach((statement) => {
      try {
        if (statement.type === 'VariableDeclaration') {
          captureVariableDeclaration(statement);
          return;
        }
        if (
          (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
          statement.declaration
        ) {
          captureVariableDeclaration(statement.declaration as ASTNode);
        }
      } catch (error) {
        ctx.logger.error('Error parsing variable:', error);
      }
    });
  });
}
