/**
 * ComplexityAnalyzer
 *
 * Walks every function-like node in the shared ts-morph Project and computes
 *   - Cyclomatic complexity (standard McCabe: 1 + decision points)
 *   - Cognitive complexity (SonarJS-style approximation with nesting weight)
 *   - Max nesting depth
 *   - Logical lines (end_line - start_line + 1)
 *   - Parameter count
 *
 * Metrics are emitted both as column patches (`EntityStatsPatch`) on the
 * `methods` / `functions` tables and as wide-format `IEntityMetricCreateDTO`
 * rows so downstream aggregation/query code can pivot either way.
 *
 * Robustness:
 *   - If `ctx.project` is null (ts-morph unavailable) the analyzer returns
 *     an empty result and logs a debug message.
 *   - If the runtime ts-morph module fails to load we return empty with a warn.
 *   - Per-function traversals are wrapped in try/catch so a malformed node
 *     cannot poison the whole batch.
 */
import type {
  ArrowFunction,
  ConstructorDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  MethodDeclaration,
  Node as TsMorphNode,
  Project,
  SetAccessorDeclaration,
  SourceFile,
  SyntaxKind as SyntaxKindType,
} from 'ts-morph';

import type { IEntityMetricCreateDTO } from '../../../shared/types/dto/EntityMetricDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
  EntityStatsPatch,
} from '../types';
import { generateEntityMetricUUID } from '../../utils/uuid';

/** Union of every ts-morph node we treat as "a function-like thing". */
type FunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration;

/** Narrow runtime shape for the subset of ts-morph enum values we need. */
type SyntaxKindRuntime = typeof SyntaxKindType;

/** Shape of the ts-morph runtime we reach for via a dynamic import. */
interface TsMorphRuntime {
  SyntaxKind: SyntaxKindRuntime;
}

interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  maxNesting: number;
  logicalLines: number;
  parameterCount: number;
}

interface ResolvedFunction {
  /** Matched parseResult entity id. */
  entityId: string;
  entityType: 'method' | 'function';
  moduleId: string;
  metrics: ComplexityMetrics;
}

/**
 * Dynamically import ts-morph at runtime. Kept in a helper so the ESLint
 * suppression stays local — the pipeline promises the dependency is present
 * by the time `ctx.project` is non-null.
 */
async function loadTsMorph(): Promise<TsMorphRuntime | null> {
  const specifier = 'ts-morph';
  try {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- lazy load so ts-morph stays optional
    return (await import(/* @vite-ignore */ specifier)) as TsMorphRuntime;
  } catch {
    return null;
  }
}

/**
 * Compute cyclomatic complexity via iterative descent. Starts at 1 and adds
 * one per decision point. We reimplement descent rather than using
 * `.forEachDescendant` so we can stop walking into nested function bodies
 * (each function gets its own complexity score, so nested functions don't
 * inflate their parent's count).
 */
function computeCyclomatic(root: TsMorphNode, syntaxKind: SyntaxKindRuntime): number {
  let complexity = 1;

  const isFunctionBoundary = (node: TsMorphNode): boolean => {
    const k: SyntaxKindType = node.getKind();
    return (
      k === syntaxKind.FunctionDeclaration ||
      k === syntaxKind.FunctionExpression ||
      k === syntaxKind.ArrowFunction ||
      k === syntaxKind.MethodDeclaration ||
      k === syntaxKind.Constructor ||
      k === syntaxKind.GetAccessor ||
      k === syntaxKind.SetAccessor
    );
  };

  const walk = (node: TsMorphNode, isRoot: boolean): void => {
    if (!isRoot && isFunctionBoundary(node)) {
      // Do not descend into nested function bodies.
      return;
    }

    const kind: SyntaxKindType = node.getKind();
    switch (kind) {
      case syntaxKind.IfStatement:
      case syntaxKind.ConditionalExpression:
      case syntaxKind.ForStatement:
      case syntaxKind.ForInStatement:
      case syntaxKind.ForOfStatement:
      case syntaxKind.WhileStatement:
      case syntaxKind.DoStatement:
      case syntaxKind.CatchClause:
      case syntaxKind.CaseClause:
        complexity += 1;
        break;
      case syntaxKind.BinaryExpression: {
        const binary = node as unknown as { getOperatorToken: () => TsMorphNode };
        const opKind: SyntaxKindType = binary.getOperatorToken().getKind();
        if (
          opKind === syntaxKind.AmpersandAmpersandToken ||
          opKind === syntaxKind.BarBarToken ||
          opKind === syntaxKind.QuestionQuestionToken
        ) {
          complexity += 1;
        }
        break;
      }
      default:
        break;
    }

    for (const child of node.getChildren()) {
      walk(child, false);
    }
  };

  walk(root, true);
  return complexity;
}

/**
 * Approximation of SonarJS cognitive complexity.
 *   - Control flow statements add 1 + nestingLevel.
 *   - Sequences of logical operators contribute 1 per sequence (we detect
 *     the "top" of a chain and charge once).
 *   - Nested function declarations add 1 + nestingLevel.
 *   - break/continue with a label adds 1.
 * We track max nesting alongside for the separate metric.
 */
function computeCognitiveAndNesting(
  root: TsMorphNode,
  syntaxKind: SyntaxKindRuntime
): { cognitive: number; maxNesting: number } {
  let cognitive = 0;
  let maxNesting = 0;

  const isFunctionBoundary = (node: TsMorphNode): boolean => {
    const k: SyntaxKindType = node.getKind();
    return (
      k === syntaxKind.FunctionDeclaration ||
      k === syntaxKind.FunctionExpression ||
      k === syntaxKind.ArrowFunction ||
      k === syntaxKind.MethodDeclaration ||
      k === syntaxKind.Constructor ||
      k === syntaxKind.GetAccessor ||
      k === syntaxKind.SetAccessor
    );
  };

  const isLogicalOp = (opKind: SyntaxKindType): boolean =>
    opKind === syntaxKind.AmpersandAmpersandToken ||
    opKind === syntaxKind.BarBarToken ||
    opKind === syntaxKind.QuestionQuestionToken;

  const walk = (node: TsMorphNode, nesting: number, isRoot: boolean): void => {
    if (!isRoot && isFunctionBoundary(node)) {
      // Nested function: pays 1 + nesting, then we recurse with incremented
      // nesting so any control flow inside still stacks.
      cognitive += 1 + nesting;
      const nextNesting = nesting + 1;
      if (nextNesting > maxNesting) maxNesting = nextNesting;
      for (const child of node.getChildren()) {
        walk(child, nextNesting, false);
      }
      return;
    }

    const kind: SyntaxKindType = node.getKind();
    let addedNesting = 0;

    switch (kind) {
      case syntaxKind.IfStatement:
      case syntaxKind.ForStatement:
      case syntaxKind.ForInStatement:
      case syntaxKind.ForOfStatement:
      case syntaxKind.WhileStatement:
      case syntaxKind.DoStatement:
      case syntaxKind.CatchClause:
      case syntaxKind.SwitchStatement:
      case syntaxKind.ConditionalExpression:
        cognitive += 1 + nesting;
        addedNesting = 1;
        break;
      case syntaxKind.BinaryExpression: {
        // Charge 1 for the "top" of a logical chain — i.e., a logical binary
        // whose parent is not another logical binary with the same operator.
        const binary = node as unknown as { getOperatorToken: () => TsMorphNode };
        const opKind: SyntaxKindType = binary.getOperatorToken().getKind();
        if (isLogicalOp(opKind)) {
          const parent = node.getParent();
          let parentIsSameLogical = false;
          if (parent?.getKind() === syntaxKind.BinaryExpression) {
            const parentBinary = parent as unknown as { getOperatorToken: () => TsMorphNode };
            const parentOp: SyntaxKindType = parentBinary.getOperatorToken().getKind();
            parentIsSameLogical = parentOp === opKind;
          }
          if (!parentIsSameLogical) {
            cognitive += 1;
          }
        }
        break;
      }
      case syntaxKind.BreakStatement:
      case syntaxKind.ContinueStatement: {
        // Labeled break/continue adds 1 flat.
        const labeled = node as unknown as { getLabel?: () => TsMorphNode | undefined };
        const label = typeof labeled.getLabel === 'function' ? labeled.getLabel() : undefined;
        if (label) cognitive += 1;
        break;
      }
      default:
        break;
    }

    const nextNesting = nesting + addedNesting;
    if (nextNesting > maxNesting) maxNesting = nextNesting;

    for (const child of node.getChildren()) {
      walk(child, nextNesting, false);
    }
  };

  walk(root, 0, true);
  return { cognitive, maxNesting };
}

/** Derive a user-facing name for a function-like node, if any. */
function getFunctionLikeName(
  node: FunctionLike,
  syntaxKind: SyntaxKindRuntime
): string | undefined {
  const kind: SyntaxKindType = node.getKind();

  if (
    kind === syntaxKind.MethodDeclaration ||
    kind === syntaxKind.GetAccessor ||
    kind === syntaxKind.SetAccessor ||
    kind === syntaxKind.FunctionDeclaration ||
    kind === syntaxKind.FunctionExpression
  ) {
    const named = node as unknown as { getName?: () => string | undefined };
    const name = typeof named.getName === 'function' ? named.getName() : undefined;
    if (name !== undefined && name !== '') return name;
  }

  if (kind === syntaxKind.Constructor) {
    return 'constructor';
  }

  // Arrow functions and anonymous function expressions: try parent
  // VariableDeclaration / PropertyAssignment / PropertyDeclaration for a name.
  const parent = node.getParent();
  const parentKind: SyntaxKindType = parent.getKind();
  if (
    parentKind === syntaxKind.VariableDeclaration ||
    parentKind === syntaxKind.PropertyAssignment ||
    parentKind === syntaxKind.PropertyDeclaration
  ) {
    const named = parent as unknown as { getName?: () => string | undefined };
    const name = typeof named.getName === 'function' ? named.getName() : undefined;
    if (name !== undefined && name !== '') return name;
  }

  return undefined;
}

/**
 * Determine if the enclosing container of `node` is a ClassDeclaration
 * (method-ish) vs. module scope. Stops at any intervening function boundary
 * so inner arrow functions aren't attributed to an outer class.
 */
function getEnclosingContainerKind(
  node: TsMorphNode,
  syntaxKind: SyntaxKindRuntime
): 'class' | 'function' {
  let current: TsMorphNode | undefined = node.getParent();
  while (current) {
    const ck: SyntaxKindType = current.getKind();
    if (ck === syntaxKind.ClassDeclaration || ck === syntaxKind.ClassExpression) {
      return 'class';
    }
    if (
      ck === syntaxKind.FunctionDeclaration ||
      ck === syntaxKind.FunctionExpression ||
      ck === syntaxKind.ArrowFunction ||
      ck === syntaxKind.MethodDeclaration
    ) {
      return 'function';
    }
    current = current.getParent();
  }
  return 'function';
}

/** Compute all complexity + size metrics for a single function-like node. */
function computeMetrics(node: FunctionLike, syntaxKind: SyntaxKindRuntime): ComplexityMetrics {
  const cyclomatic = computeCyclomatic(node, syntaxKind);
  const { cognitive, maxNesting } = computeCognitiveAndNesting(node, syntaxKind);

  const start = node.getStartLineNumber();
  const end = node.getEndLineNumber();
  const logicalLines = end - start + 1;

  const parameterCount = node.getParameters().length;

  return { cyclomatic, cognitive, maxNesting, logicalLines, parameterCount };
}

export class ComplexityAnalyzer implements Analyzer {
  public id = 'complexity';
  public category: AnalyzerCategory = 'complexity';
  public requires: AnalyzerCapability[] = ['tsMorph'];

  public enabled(config: AnalysisConfig): boolean {
    return config.deep ?? false;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, snapshotId, logger } = ctx;

    if (ctx.project === null || ctx.project === undefined) {
      logger.debug('[ComplexityAnalyzer] ctx.project is null; skipping.');
      return {};
    }

    const tsMorph = await loadTsMorph();
    if (tsMorph === null) {
      logger.warn('[ComplexityAnalyzer] ts-morph runtime unavailable; returning empty result.');
      return {};
    }
    const { SyntaxKind: syntaxKind } = tsMorph;

    const project = ctx.project as Project;

    // Index parseResult entities by module_id for fast lookup.
    const moduleByFilename = new Map<string, string>();
    for (const mod of parseResult.modules) {
      moduleByFilename.set(mod.source.filename, mod.id);
    }

    // key: `${module_id}::${parent_type}::${name}` -> entity_id
    const methodsByKey = new Map<string, string>();
    for (const method of parseResult.methods) {
      methodsByKey.set(`${method.module_id}::${method.parent_type}::${method.name}`, method.id);
    }

    // key: `${module_id}::${name}` -> entity_id
    const functionsByKey = new Map<string, string>();
    for (const fn of parseResult.functions) {
      functionsByKey.set(`${fn.module_id}::${fn.name}`, fn.id);
    }

    const resolved: ResolvedFunction[] = [];

    const functionLikeKinds: SyntaxKindType[] = [
      syntaxKind.FunctionDeclaration,
      syntaxKind.MethodDeclaration,
      syntaxKind.ArrowFunction,
      syntaxKind.FunctionExpression,
      syntaxKind.Constructor,
      syntaxKind.GetAccessor,
      syntaxKind.SetAccessor,
    ];

    const sourceFiles: SourceFile[] = project.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();
      const moduleId = moduleByFilename.get(String(filePath));
      if (moduleId === undefined) continue;

      for (const kind of functionLikeKinds) {
        let nodes: FunctionLike[] = [];
        try {
          nodes = sourceFile.getDescendantsOfKind(kind) as FunctionLike[];
        } catch (err) {
          logger.debug(
            `[ComplexityAnalyzer] getDescendantsOfKind failed for ${String(filePath)}: ${String(err)}`
          );
          continue;
        }

        for (const fnNode of nodes) {
          try {
            const name = getFunctionLikeName(fnNode, syntaxKind);
            if (name === undefined) continue;

            const enclosing = getEnclosingContainerKind(fnNode, syntaxKind);

            let entityId: string | undefined;
            let entityType: 'method' | 'function';

            if (enclosing === 'class') {
              entityType = 'method';
              entityId = methodsByKey.get(`${moduleId}::class::${name}`);
            } else {
              entityType = 'function';
              entityId = functionsByKey.get(`${moduleId}::${name}`);
            }

            if (entityId === undefined) continue;

            const metrics = computeMetrics(fnNode, syntaxKind);
            resolved.push({ entityId, entityType, moduleId, metrics });
          } catch (err) {
            logger.debug(
              `[ComplexityAnalyzer] complexity traversal failed for ${String(filePath)}: ${String(err)}`
            );
            continue;
          }
        }
      }
    }

    const metrics: IEntityMetricCreateDTO[] = [];
    const entityStats: EntityStatsPatch[] = [];

    for (const item of resolved) {
      entityStats.push({
        entity_id: item.entityId,
        entity_type: item.entityType,
        columns: {
          cyclomatic: item.metrics.cyclomatic,
          cognitive: item.metrics.cognitive,
          max_nesting: item.metrics.maxNesting,
          logical_lines: item.metrics.logicalLines,
          parameter_count: item.metrics.parameterCount,
        },
      });

      const rows: { key: string; value: number; category: 'complexity' | 'size' }[] = [
        { key: 'complexity.cyclomatic', value: item.metrics.cyclomatic, category: 'complexity' },
        { key: 'complexity.cognitive', value: item.metrics.cognitive, category: 'complexity' },
        { key: 'complexity.maxNesting', value: item.metrics.maxNesting, category: 'complexity' },
        { key: 'size.logicalLines', value: item.metrics.logicalLines, category: 'size' },
        { key: 'complexity.parameterCount', value: item.metrics.parameterCount, category: 'complexity' },
      ];

      for (const row of rows) {
        metrics.push({
          id: generateEntityMetricUUID(snapshotId, item.entityId, item.entityType, row.key),
          snapshot_id: snapshotId,
          package_id: packageId,
          module_id: item.moduleId,
          entity_id: item.entityId,
          entity_type: item.entityType,
          metric_key: row.key,
          metric_value: row.value,
          metric_category: row.category,
        });
      }
    }

    return { metrics, entityStats };
  }
}
