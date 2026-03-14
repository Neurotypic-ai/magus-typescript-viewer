import type { ASTNode, ASTPath, Identifier, TSTypeAnnotation, TSTypeParameter } from 'jscodeshift';
import type { ModuleParserContext } from './types';
import type { ParseResult } from '../ParseResult';
import type { IFunctionCreateDTO } from '../../db/repositories/FunctionRepository';
import type { ITypeAliasCreateDTO } from '../../db/repositories/TypeAliasRepository';
import type { IEnumCreateDTO } from '../../db/repositories/EnumRepository';
import type { IVariableCreateDTO } from '../../db/repositories/VariableRepository';
import { getIdentifierName, getTypeFromAnnotation, getReturnTypeFromNode, extractSymbolUsages } from './astUtils';
import { generateFunctionUUID, generateTypeAliasUUID, generateEnumUUID, generateVariableUUID } from '../../utils/uuid';

// ---------------------------------------------------------------------------
// Generic symbol parser factory
// ---------------------------------------------------------------------------

/**
 * Generic helper that encapsulates the shared pattern across parseFunctions,
 * parseTypeAliases, parseEnums, and parseVariables:
 * 1. Walk `Program.body` for top-level and export-wrapped declarations
 * 2. Filter by matching AST node type(s)
 * 3. Delegate to a capture callback
 *
 * The `nodeTypes` array lists the statement types to match directly.
 * The `capture` callback receives the matched node and performs the
 * domain-specific extraction logic.
 */
function walkExportedDeclarations(
  ctx: ModuleParserContext,
  nodeTypes: string[],
  capture: (node: ASTNode) => void,
  errorLabel: string
): void {
  ctx.root.find(ctx.j.Program).forEach((programPath: ASTPath) => {
    const programNode = programPath.node;
    if (programNode.type !== 'Program') return;

    programNode.body.forEach((statement) => {
      try {
        if (nodeTypes.includes(statement.type)) {
          capture(statement);
          return;
        }

        if (
          (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
          statement.declaration
        ) {
          capture(statement.declaration as ASTNode);
        }
      } catch (error) {
        ctx.logger.error(`Error parsing ${errorLabel}:`, error);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 1. parseFunctions
// ---------------------------------------------------------------------------

/**
 * Parse module-level function declarations
 */
export function parseFunctions(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  walkExportedDeclarations(
    ctx,
    ['FunctionDeclaration'],
    (node: ASTNode): void => {
      if (node.type !== 'FunctionDeclaration' || !node.id) return;

      const functionName = getIdentifierName(node.id);
      if (!functionName) return;

      // Only capture exported functions — this tool visualizes public API surface
      if (!exports.has(functionName)) return;

      const functionId = generateFunctionUUID(ctx.packageId, ctx.moduleId, functionName);
      if (seenIds.has(functionId)) return;
      seenIds.add(functionId);

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

      // TODO: Extract call graph edges from function body AST node.
      // The function body is available here as `node.body` (BlockStatement).
      // Call extractCallEdges(ctx.j, node.body, functionId, functionName) from
      // '../utils/extractCallGraph' and push results to result.callEdges.
      // This requires the callEdges field on ParseResult (already added).

      const usages = extractSymbolUsages(ctx.j, node, {
        moduleId: ctx.moduleId,
        sourceSymbolId: functionId,
        sourceSymbolType: 'function',
        sourceSymbolName: functionName,
      });
      if (usages.length > 0) {
        result.symbolUsages.push(...usages);
      }
    },
    'function'
  );
}

// ---------------------------------------------------------------------------
// 2. parseTypeAliases
// ---------------------------------------------------------------------------

/**
 * Parse module-level type alias declarations (type Foo = ...)
 */
export function parseTypeAliases(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  walkExportedDeclarations(
    ctx,
    ['TSTypeAliasDeclaration'],
    (node: ASTNode): void => {
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
    },
    'type alias'
  );
}

// ---------------------------------------------------------------------------
// 3. parseEnums
// ---------------------------------------------------------------------------

/**
 * Parse module-level enum declarations
 */
export function parseEnums(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  walkExportedDeclarations(
    ctx,
    ['TSEnumDeclaration'],
    (node: ASTNode): void => {
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
    },
    'enum'
  );
}

// ---------------------------------------------------------------------------
// 4. parseVariables
// ---------------------------------------------------------------------------

/**
 * Parse module-level variable declarations (const, let, var)
 */
export function parseVariables(ctx: ModuleParserContext, exports: Set<string>, result: ParseResult): void {
  const seenIds = new Set<string>();

  walkExportedDeclarations(
    ctx,
    ['VariableDeclaration'],
    (node: ASTNode): void => {
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
    },
    'variable'
  );
}
