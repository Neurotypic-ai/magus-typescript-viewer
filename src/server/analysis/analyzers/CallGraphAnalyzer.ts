/**
 * CallGraphAnalyzer
 *
 * Builds the function/method call graph by walking every CallExpression in
 * the shared ts-morph `Project` and attributing each call to the enclosing
 * function-like declaration (FunctionDeclaration, MethodDeclaration,
 * ArrowFunction, FunctionExpression, Constructor, Get/SetAccessor).
 *
 * Resolution strategy (per-call):
 *   1. Try `callee.getSymbol()`; inspect the first declaration.
 *      - If inside node_modules: `external`.
 *      - If inside a Project source file: try to match the declaration's
 *        enclosing function/method back to the parseResult by (module_id, name).
 *        If found: `resolved`.
 *   2. Fall back to parseResult name-maps (deferred-name pattern):
 *      - Unique match => `resolved`.
 *      - Multiple matches => `ambiguous`.
 *      - No match => `unresolved`.
 *
 * Call-target extraction:
 *   - Identifier callee   => `target_name = callee.text`, no qualifier.
 *   - PropertyAccess      => `target_name = property.name`, qualifier = expression text.
 *   - Anything else       => `unresolved`, best-effort target_name (may be empty).
 *
 * Correctness > completeness for Phase 2: a 50% resolution rate is acceptable.
 */
import type {
  Project,
  Node,
  SourceFile,
  SyntaxKind as SyntaxKindType,
  CallExpression,
} from 'ts-morph';

import type { ICallEdgeCreateDTO, CallEndpointType } from '../../../shared/types/dto/CallEdgeDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
} from '../types';
import { generateCallEdgeUUID } from '../../utils/uuid';

type SyntaxKindEnum = typeof SyntaxKindType;

interface NameMapEntry {
  id: string;
  type: CallEndpointType;
}

interface EnclosingFunction {
  /** ts-morph node for the enclosing function-like declaration. */
  node: Node;
  /** Name of the function/method; `undefined` for anonymous callbacks. */
  name: string | undefined;
  /** `method` if enclosed in a class-like container, else `function`. */
  entityType: CallEndpointType;
  /** Whether the enclosing function is declared `async`. */
  isAsync: boolean;
}

interface CallTarget {
  name: string;
  qualifier: string | undefined;
  calleeNode: Node;
}

const FUNCTION_LIKE_KIND_NAMES = [
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunction',
  'MethodDeclaration',
  'Constructor',
  'GetAccessor',
  'SetAccessor',
] as const;

/** Check if a ts-morph node kind represents a function-like declaration. */
function isFunctionLikeKind(kind: number, syntaxKind: SyntaxKindEnum): boolean {
  for (const name of FUNCTION_LIKE_KIND_NAMES) {
    const target: number = syntaxKind[name];
    if (target === kind) return true;
  }
  return false;
}

/** Best-effort read of `.getName()` on a node; returns undefined if unavailable or empty. */
function tryGetName(node: Node): string | undefined {
  const named = node as unknown as { getName?: () => string | undefined };
  if (typeof named.getName !== 'function') return undefined;
  try {
    const name = named.getName();
    if (typeof name !== 'string' || name.length === 0) return undefined;
    return name;
  } catch {
    return undefined;
  }
}

/** Best-effort read of `.isAsync()` on a node. */
function tryIsAsync(node: Node): boolean {
  const asyncable = node as unknown as { isAsync?: () => boolean };
  if (typeof asyncable.isAsync !== 'function') return false;
  try {
    return asyncable.isAsync();
  } catch {
    return false;
  }
}

/**
 * Walk ancestors of a CallExpression and find the nearest function-like
 * container. If that container is a MethodDeclaration/Constructor/accessor
 * nested in a class, treat it as a method; else a function.
 */
function findEnclosingFunction(
  call: CallExpression,
  syntaxKind: SyntaxKindEnum
): EnclosingFunction | undefined {
  let current: Node | undefined = call.getParent();
  while (current) {
    const kind = current.getKind();
    if (isFunctionLikeKind(kind, syntaxKind)) {
      const isMethodKind =
        kind === syntaxKind.MethodDeclaration ||
        kind === syntaxKind.Constructor ||
        kind === syntaxKind.GetAccessor ||
        kind === syntaxKind.SetAccessor;

      let name = tryGetName(current);
      if (!name && kind === syntaxKind.Constructor) {
        name = 'constructor';
      }
      if (!name) {
        // Arrow function / anonymous fn: check if the parent is a
        // VariableDeclaration/PropertyAssignment/PropertyDeclaration that
        // gives it a name.
        const parent = current.getParent();
        if (parent) {
          const pk = parent.getKind();
          if (
            pk === syntaxKind.VariableDeclaration ||
            pk === syntaxKind.PropertyAssignment ||
            pk === syntaxKind.PropertyDeclaration
          ) {
            name = tryGetName(parent);
          }
        }
      }

      // Classify as method if enclosed in a class declaration somewhere
      // above the function-like node.
      let entityType: CallEndpointType = isMethodKind ? 'method' : 'function';
      if (!isMethodKind) {
        let ancestor: Node | undefined = current.getParent();
        while (ancestor) {
          const ak = ancestor.getKind();
          if (ak === syntaxKind.ClassDeclaration || ak === syntaxKind.ClassExpression) {
            entityType = 'method';
            break;
          }
          if (isFunctionLikeKind(ak, syntaxKind)) break; // stop at next function boundary
          ancestor = ancestor.getParent();
        }
      }

      return {
        node: current,
        name,
        entityType,
        isAsync: tryIsAsync(current),
      };
    }
    current = current.getParent();
  }
  return undefined;
}

/** Extract a usable call target from the callee of a CallExpression. */
function extractCallTarget(
  call: CallExpression,
  syntaxKind: SyntaxKindEnum
): CallTarget | undefined {
  const callee = call.getExpression();
  const kind = callee.getKind();

  if (kind === syntaxKind.Identifier) {
    const text = callee.getText();
    if (text.length === 0) return undefined;
    return { name: text, qualifier: undefined, calleeNode: callee };
  }

  if (kind === syntaxKind.PropertyAccessExpression) {
    // PropertyAccessExpression exposes getName() (from NamedNode) for the
    // property name and getExpression() for the qualifier expression.
    const pae = callee as unknown as {
      getName?: () => string;
      getExpression?: () => Node;
    };
    const name = typeof pae.getName === 'function' ? pae.getName() : undefined;
    const qualifierNode = typeof pae.getExpression === 'function' ? pae.getExpression() : undefined;
    if (!name || name.length === 0) return undefined;
    const qualifierText = qualifierNode?.getText();
    return {
      name,
      qualifier: qualifierText && qualifierText.length > 0 ? qualifierText : undefined,
      calleeNode: callee,
    };
  }

  // Computed or other complex expressions: bail out.
  return undefined;
}

/** Is this CallExpression's direct parent an `await <call>` expression? */
function isImmediatelyAwaited(call: CallExpression, syntaxKind: SyntaxKindEnum): boolean {
  const parent = call.getParent();
  if (!parent) return false;
  return parent.getKind() === syntaxKind.AwaitExpression;
}

/**
 * Determine whether a symbol declaration's enclosing function/method matches
 * an entity in the parseResult. Returns the matched entity, if any.
 */
function resolveDeclarationToEntity(
  declarationNode: Node,
  syntaxKind: SyntaxKindEnum,
  moduleByFilename: Map<string, string>,
  methodsByModuleAndName: Map<string, NameMapEntry[]>,
  functionsByModuleAndName: Map<string, NameMapEntry[]>
): { entityId: string; entityType: CallEndpointType } | undefined {
  // The declaration itself might be a FunctionDeclaration / MethodDeclaration
  // etc., or a VariableDeclaration for `const foo = () => ...`. Normalize by
  // finding the nearest function-like ancestor (or the declaration itself if
  // it is one).
  let functionLike: Node | undefined;
  if (isFunctionLikeKind(declarationNode.getKind(), syntaxKind)) {
    functionLike = declarationNode;
  } else {
    // Search descendants (for VariableDeclaration wrapping an arrow function)
    // *and* ancestors (for a parameter/identifier declaration inside a fn).
    const children = declarationNode.getChildren();
    for (const child of children) {
      if (isFunctionLikeKind(child.getKind(), syntaxKind)) {
        functionLike = child;
        break;
      }
    }
    if (!functionLike) {
      let ancestor: Node | undefined = declarationNode.getParent();
      while (ancestor) {
        if (isFunctionLikeKind(ancestor.getKind(), syntaxKind)) {
          functionLike = ancestor;
          break;
        }
        ancestor = ancestor.getParent();
      }
    }
  }

  // Derive a name: either from the function-like, or from the declaration
  // when it has its own name (e.g., VariableDeclaration).
  let name: string | undefined;
  if (functionLike) {
    name = tryGetName(functionLike);
  }
  name ??= tryGetName(declarationNode);
  if (!name) return undefined;

  const sourceFile = declarationNode.getSourceFile();
  const filePath = String(sourceFile.getFilePath());
  const moduleId = moduleByFilename.get(filePath);
  if (!moduleId) return undefined;

  // Prefer method match (class-scoped), fall back to function.
  const methodKey = `${moduleId}::${name}`;
  const methodMatches = methodsByModuleAndName.get(methodKey);
  if (methodMatches?.length === 1) {
    const first = methodMatches[0];
    if (first) return { entityId: first.id, entityType: first.type };
  }
  const fnMatches = functionsByModuleAndName.get(methodKey);
  if (fnMatches?.length === 1) {
    const first = fnMatches[0];
    if (first) return { entityId: first.id, entityType: first.type };
  }
  return undefined;
}

export class CallGraphAnalyzer implements Analyzer {
  public id = 'call-graph';
  public category: AnalyzerCategory = 'structure';
  public requires: AnalyzerCapability[] = ['tsMorph'];

  public enabled(config: AnalysisConfig): boolean {
    return config.deep ?? false;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, logger } = ctx;

    if (ctx.project === null) {
      logger.debug('[CallGraphAnalyzer] ctx.project is null; skipping.');
      return {};
    }

    let syntaxKind: SyntaxKindEnum;
    try {
      const specifier = 'ts-morph';
      // eslint-disable-next-line dollarwise/no-dynamic-imports -- lazy load so ts-morph stays optional
      const tsMorph = (await import(/* @vite-ignore */ specifier)) as {
        SyntaxKind: SyntaxKindEnum;
      };
      syntaxKind = tsMorph.SyntaxKind;
    } catch (err) {
      logger.warn('[CallGraphAnalyzer] ts-morph failed to load; returning empty result.', err);
      return {};
    }

    const project = ctx.project as Project;

    // Index modules by filename, and build flat + keyed name maps.
    const moduleByFilename = new Map<string, string>();
    for (const mod of parseResult.modules) {
      moduleByFilename.set(mod.source.filename, mod.id);
    }

    // Per-name maps across the whole package (deferred-name fallback).
    const methodNameToEntities = new Map<string, NameMapEntry[]>();
    const functionNameToEntities = new Map<string, NameMapEntry[]>();
    // Per-(module,name) maps used when we have a symbol → file → module.
    const methodsByModuleAndName = new Map<string, NameMapEntry[]>();
    const functionsByModuleAndName = new Map<string, NameMapEntry[]>();

    const pushMapEntry = (
      map: Map<string, NameMapEntry[]>,
      key: string,
      entry: NameMapEntry
    ): void => {
      const existing = map.get(key);
      if (existing) {
        if (!existing.some((e) => e.id === entry.id)) existing.push(entry);
        return;
      }
      map.set(key, [entry]);
    };

    for (const method of parseResult.methods) {
      const entry: NameMapEntry = { id: method.id, type: 'method' };
      pushMapEntry(methodNameToEntities, method.name, entry);
      pushMapEntry(methodsByModuleAndName, `${method.module_id}::${method.name}`, entry);
    }
    for (const fn of parseResult.functions) {
      const entry: NameMapEntry = { id: fn.id, type: 'function' };
      pushMapEntry(functionNameToEntities, fn.name, entry);
      pushMapEntry(functionsByModuleAndName, `${fn.module_id}::${fn.name}`, entry);
    }

    const callEdgesById = new Map<string, ICallEdgeCreateDTO>();

    const sourceFiles: SourceFile[] = project.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      const filePath = String(sourceFile.getFilePath());
      const moduleId = moduleByFilename.get(filePath);
      if (!moduleId) continue;

      let calls: CallExpression[] = [];
      try {
        calls = sourceFile.getDescendantsOfKind(syntaxKind.CallExpression);
      } catch (err) {
        logger.debug(
          `[CallGraphAnalyzer] getDescendantsOfKind failed for ${filePath}: ${String(err)}`
        );
        continue;
      }

      for (const call of calls) {
        try {
          const enclosing = findEnclosingFunction(call, syntaxKind);
          if (!enclosing?.name) continue; // skip top-level / anonymous

          // Match enclosing to a parseResult entity by (module_id, name).
          const sourceKey = `${moduleId}::${enclosing.name}`;
          let sourceEntityId: string | undefined;
          let sourceEntityType: CallEndpointType;
          if (enclosing.entityType === 'method') {
            const matches = methodsByModuleAndName.get(sourceKey);
            const first = matches?.length === 1 ? matches[0] : undefined;
            if (first) {
              sourceEntityId = first.id;
              sourceEntityType = first.type;
            } else {
              continue;
            }
          } else {
            const matches = functionsByModuleAndName.get(sourceKey);
            const first = matches?.length === 1 ? matches[0] : undefined;
            if (first) {
              sourceEntityId = first.id;
              sourceEntityType = first.type;
            } else {
              // Fallback: maybe an arrow function whose name is stored as a method
              const methodMatches = methodsByModuleAndName.get(sourceKey);
              const methodFirst = methodMatches?.length === 1 ? methodMatches[0] : undefined;
              if (methodFirst) {
                sourceEntityId = methodFirst.id;
                sourceEntityType = methodFirst.type;
              } else {
                continue;
              }
            }
          }

          if (!sourceEntityId) continue;

          const target = extractCallTarget(call, syntaxKind);
          const callLine = call.getStartLineNumber();
          const isAwaited = isImmediatelyAwaited(call, syntaxKind);

          let resolutionStatus: ICallEdgeCreateDTO['resolution_status'] = 'unresolved';
          let targetEntityId: string | undefined;
          let targetEntityType: CallEndpointType | undefined;
          let targetName: string | undefined;
          let targetQualifier: string | undefined;
          let targetIsAsync = false;

          if (!target) {
            // Computed/complex callee — record an unresolved edge using the
            // raw callee text so downstream tooling has something.
            const calleeText = call.getExpression().getText();
            targetName = calleeText.length > 0 ? calleeText : undefined;
            resolutionStatus = 'unresolved';
          } else {
            targetName = target.name;
            targetQualifier = target.qualifier;

            // 1) ts-morph symbol resolution.
            let symbolResolved = false;
            try {
              const symbol = (target.calleeNode as unknown as {
                getSymbol?: () => { getDeclarations: () => Node[] } | undefined;
              }).getSymbol?.();
              if (symbol) {
                const declarations = symbol.getDeclarations();
                const firstDecl = declarations[0];
                if (firstDecl) {
                  const declSourceFile = firstDecl.getSourceFile();
                  const inNodeModules = declSourceFile.isInNodeModules();
                  if (inNodeModules) {
                    resolutionStatus = 'external';
                    symbolResolved = true;
                  } else {
                    targetIsAsync = tryIsAsync(firstDecl) || targetIsAsync;
                    const matched = resolveDeclarationToEntity(
                      firstDecl,
                      syntaxKind,
                      moduleByFilename,
                      methodsByModuleAndName,
                      functionsByModuleAndName
                    );
                    if (matched) {
                      targetEntityId = matched.entityId;
                      targetEntityType = matched.entityType;
                      resolutionStatus = 'resolved';
                      symbolResolved = true;
                    }
                  }
                }
              }
            } catch (err) {
              logger.debug(
                `[CallGraphAnalyzer] symbol resolution threw for call at ${filePath}:${String(callLine)}: ${String(err)}`
              );
            }

            // 2) Fall back to the name-map (deferred-name pattern).
            if (!symbolResolved && targetName) {
              // Prefer method match when qualified (obj.method), function match otherwise.
              const preferMethod = target.qualifier !== undefined;
              const methodMatches = methodNameToEntities.get(targetName) ?? [];
              const fnMatches = functionNameToEntities.get(targetName) ?? [];

              const primary = preferMethod ? methodMatches : fnMatches;
              const secondary = preferMethod ? fnMatches : methodMatches;

              if (primary.length === 1) {
                const first = primary[0];
                if (first) {
                  targetEntityId = first.id;
                  targetEntityType = first.type;
                  resolutionStatus = 'resolved';
                }
              } else if (primary.length > 1) {
                resolutionStatus = 'ambiguous';
              } else if (secondary.length === 1) {
                const first = secondary[0];
                if (first) {
                  targetEntityId = first.id;
                  targetEntityType = first.type;
                  resolutionStatus = 'resolved';
                }
              } else if (secondary.length > 1) {
                resolutionStatus = 'ambiguous';
              } else {
                resolutionStatus = 'unresolved';
              }
            }
          }

          const isAsyncCall = isAwaited || targetIsAsync || enclosing.isAsync;

          const idKey = targetName ?? '__unknown__';
          const id = generateCallEdgeUUID(sourceEntityId, idKey, callLine);
          if (callEdgesById.has(id)) continue;

          const edge: ICallEdgeCreateDTO = {
            id,
            package_id: packageId,
            module_id: moduleId,
            source_entity_id: sourceEntityId,
            source_entity_type: sourceEntityType,
            resolution_status: resolutionStatus,
            call_expression_line: callLine,
            is_async_call: isAsyncCall,
            is_awaited: isAwaited,
          };
          if (targetEntityId !== undefined) edge.target_entity_id = targetEntityId;
          if (targetEntityType !== undefined) edge.target_entity_type = targetEntityType;
          if (targetName !== undefined) edge.target_name = targetName;
          if (targetQualifier !== undefined) edge.target_qualifier = targetQualifier;

          callEdgesById.set(id, edge);
        } catch (err) {
          logger.debug(
            `[CallGraphAnalyzer] failed to process CallExpression in ${filePath}: ${String(err)}`
          );
          continue;
        }
      }
    }

    const callEdges = Array.from(callEdgesById.values());
    return { callEdges };
  }
}
