/**
 * TypeSafetyAnalyzer
 *
 * Counts per-module type-safety signals by walking the shared ts-morph
 * Project:
 *   - `any` keyword occurrences
 *   - `unknown` keyword occurrences
 *   - `as` assertions  (`x as Foo`)
 *   - Angle-bracket assertions (`<Foo>x`)
 *   - Non-null assertions  (`foo!`)
 *   - `@ts-ignore` / `@ts-expect-error` comments
 *   - Total identifier count (used as a denominator for density)
 *
 * Also detects implicit-`any` parameters via the type checker (no explicit
 * `TypeNode`, yet the checker resolves the parameter type to `'any'`) and
 * emits per-parameter `EntityStatsPatch` rows flipping `is_implicit_any` /
 * `type_is_any` on the parameter table.
 *
 * Robustness:
 *   - If `ctx.project` is null (ts-morph unavailable) the analyzer returns
 *     an empty result and logs a debug message.
 *   - If dynamic `import('ts-morph')` fails we return empty with a warn.
 *   - Per-file computation is wrapped in try/catch so a malformed source
 *     file cannot poison the whole batch.
 */
import type {
  FunctionDeclaration,
  MethodDeclaration,
  ParameterDeclaration,
  Project,
  SourceFile,
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

interface TypeSafetyCounts {
  anyCount: number;
  unknownCount: number;
  asAssertionCount: number;
  angleAssertionCount: number;
  nonNullAssertionCount: number;
  tsIgnoreCount: number;
  totalIdentifiers: number;
}

const TS_IGNORE_REGEX = /@ts-(?:ignore|expect-error)\b/;

/**
 * Count `@ts-ignore` and `@ts-expect-error` directives by scanning the raw
 * source text. Walking every comment range on every node is expensive, so
 * we settle for a linear text scan — false positives inside string literals
 * are unlikely in practice.
 */
function countTsIgnoreComments(source: string): number {
  let count = 0;
  // Line comments: // @ts-ignore / // @ts-expect-error
  const lineCommentRegex = /\/\/[^\n]*/g;
  for (const match of source.matchAll(lineCommentRegex)) {
    if (TS_IGNORE_REGEX.test(match[0])) count += 1;
  }
  // Block comments: /* ... @ts-ignore ... */
  const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
  for (const match of source.matchAll(blockCommentRegex)) {
    if (TS_IGNORE_REGEX.test(match[0])) count += 1;
  }
  return count;
}

export class TypeSafetyAnalyzer implements Analyzer {
  public id = 'type-safety';
  public category: AnalyzerCategory = 'typeSafety';
  public requires: AnalyzerCapability[] = ['tsMorph'];

  public enabled(config: AnalysisConfig): boolean {
    return config.deep ?? false;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, snapshotId, logger } = ctx;

    if (ctx.project === null) {
      logger.debug('[TypeSafetyAnalyzer] ctx.project is null; skipping.');
      return {};
    }

    let syntaxKind: typeof import('ts-morph').SyntaxKind;
    try {
      const tsMorph = (await import('ts-morph')) as typeof import('ts-morph');
      syntaxKind = tsMorph.SyntaxKind;
    } catch (err) {
      logger.warn('[TypeSafetyAnalyzer] ts-morph failed to load; returning empty result.', err);
      return {};
    }

    const project = ctx.project as Project;

    // Index modules by filename for fast lookup.
    const moduleByFilename = new Map<string, string>();
    for (const mod of parseResult.modules) {
      moduleByFilename.set(mod.source.filename, mod.id);
    }

    // Index parameters by `${module_id}::${method_id}::${name}` for implicit-any patching.
    // We cannot reconstruct method_id from ts-morph alone, so we also index
    // by `${module_id}::${parameter_name}` grouped under method name.
    const parametersByMethodAndName = new Map<string, string>(); // key: `${method_id}::${name}` -> parameter_id
    for (const param of parseResult.parameters) {
      parametersByMethodAndName.set(`${param.method_id}::${param.name}`, param.id);
    }

    // Index methods by `${module_id}::${parent_type}::${name}` -> method_id
    const methodIdByKey = new Map<string, string>();
    for (const method of parseResult.methods) {
      methodIdByKey.set(`${method.module_id}::${method.parent_type}::${method.name}`, method.id);
    }

    // Index functions by `${module_id}::${name}` -> function_id. Functions
    // have no parameters in the parameters table (only methods do), but we
    // keep this lookup for symmetry in case that changes later.
    const functionIdByKey = new Map<string, string>();
    for (const fn of parseResult.functions) {
      functionIdByKey.set(`${fn.module_id}::${fn.name}`, fn.id);
    }

    const metrics: IEntityMetricCreateDTO[] = [];
    const entityStats: EntityStatsPatch[] = [];

    // Track parameter-level implicit-any patches by parameter_id so we don't
    // emit duplicate rows if the same parameter is visited twice.
    const parameterPatchById = new Map<string, EntityStatsPatch>();

    // Pre-pass: parameters whose parser-captured `type` is literally `'any'`.
    for (const param of parseResult.parameters) {
      if (param.type === 'any') {
        parameterPatchById.set(param.id, {
          entity_id: param.id,
          entity_type: 'parameter',
          columns: { type_is_any: true },
        });
      }
    }

    const sourceFiles: SourceFile[] = project.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      const filePath = String(sourceFile.getFilePath());
      const moduleId = moduleByFilename.get(filePath);
      if (!moduleId) continue;

      let counts: TypeSafetyCounts;
      try {
        const anyCount = sourceFile.getDescendantsOfKind(syntaxKind.AnyKeyword).length;
        const unknownCount = sourceFile.getDescendantsOfKind(syntaxKind.UnknownKeyword).length;
        const asAssertionCount = sourceFile.getDescendantsOfKind(syntaxKind.AsExpression).length;
        const angleAssertionCount = sourceFile.getDescendantsOfKind(
          syntaxKind.TypeAssertionExpression
        ).length;
        const nonNullAssertionCount = sourceFile.getDescendantsOfKind(
          syntaxKind.NonNullExpression
        ).length;
        const totalIdentifiers = sourceFile.getDescendantsOfKind(syntaxKind.Identifier).length;
        const tsIgnoreCount = countTsIgnoreComments(sourceFile.getFullText());

        counts = {
          anyCount,
          unknownCount,
          asAssertionCount,
          angleAssertionCount,
          nonNullAssertionCount,
          tsIgnoreCount,
          totalIdentifiers,
        };
      } catch (err) {
        logger.warn(
          `[TypeSafetyAnalyzer] failed to compute counts for ${filePath}; skipping.`,
          err instanceof Error ? err.message : String(err)
        );
        continue;
      }

      const anyDensity = counts.anyCount / Math.max(counts.totalIdentifiers, 1);

      const rows: { key: string; value: number }[] = [
        { key: 'typeSafety.anyCount', value: counts.anyCount },
        { key: 'typeSafety.unknownCount', value: counts.unknownCount },
        { key: 'typeSafety.asAssertionCount', value: counts.asAssertionCount },
        { key: 'typeSafety.angleAssertionCount', value: counts.angleAssertionCount },
        { key: 'typeSafety.nonNullAssertionCount', value: counts.nonNullAssertionCount },
        { key: 'typeSafety.tsIgnoreCount', value: counts.tsIgnoreCount },
        { key: 'typeSafety.totalIdentifiers', value: counts.totalIdentifiers },
        { key: 'typeSafety.anyDensity', value: anyDensity },
      ];

      for (const row of rows) {
        metrics.push({
          id: generateEntityMetricUUID(snapshotId, moduleId, 'module', row.key),
          snapshot_id: snapshotId,
          package_id: packageId,
          module_id: moduleId,
          entity_id: moduleId,
          entity_type: 'module',
          metric_key: row.key,
          metric_value: row.value,
          metric_category: 'typeSafety',
        });
      }

      // Implicit-any parameter detection via the type checker. We walk
      // function-like declarations known to carry parameters we actually
      // persist: FunctionDeclaration and MethodDeclaration.
      try {
        const functionDecls: FunctionDeclaration[] = sourceFile.getDescendantsOfKind(
          syntaxKind.FunctionDeclaration
        );
        const methodDecls: MethodDeclaration[] = sourceFile.getDescendantsOfKind(
          syntaxKind.MethodDeclaration
        );

        for (const fn of functionDecls) {
          const fnName = fn.getName();
          if (!fnName) continue;
          const functionId = functionIdByKey.get(`${moduleId}::${fnName}`);
          // Functions don't have entries in ParseResult.parameters (methods do),
          // but we still check so this analyzer remains useful if the parser
          // is extended later. Without a matching function_id we can't map
          // the parameter entity, so skip.
          if (!functionId) continue;
          markImplicitAnyParameters(
            fn.getParameters(),
            functionId,
            parametersByMethodAndName,
            parameterPatchById
          );
        }

        for (const method of methodDecls) {
          const methodName = method.getName();
          if (!methodName) continue;

          // Determine the parent kind so we can key into methodIdByKey.
          const parentKind = method.getParent().getKind();
          let parentType: 'class' | 'interface' | null = null;
          if (parentKind === syntaxKind.ClassDeclaration) {
            parentType = 'class';
          } else if (parentKind === syntaxKind.InterfaceDeclaration) {
            parentType = 'interface';
          }
          if (!parentType) continue;

          const methodId = methodIdByKey.get(`${moduleId}::${parentType}::${methodName}`);
          if (!methodId) continue;

          markImplicitAnyParameters(
            method.getParameters(),
            methodId,
            parametersByMethodAndName,
            parameterPatchById
          );
        }
      } catch (err) {
        logger.debug(
          `[TypeSafetyAnalyzer] implicit-any sweep failed for ${filePath}: ${String(err)}`
        );
      }
    }

    entityStats.push(...parameterPatchById.values());

    return { metrics, entityStats };
  }
}

/**
 * For every parameter declaration without an explicit TypeNode whose
 * inferred type text is `'any'`, flip `is_implicit_any = true` on the
 * matching `parameter` row.
 */
function markImplicitAnyParameters(
  parameters: ParameterDeclaration[],
  methodId: string,
  parametersByMethodAndName: Map<string, string>,
  parameterPatchById: Map<string, EntityStatsPatch>
): void {
  for (const parameter of parameters) {
    let hasExplicitTypeNode = false;
    try {
      hasExplicitTypeNode = parameter.getTypeNode() !== undefined;
    } catch {
      hasExplicitTypeNode = true; // fail closed — assume explicit to avoid noise
    }
    if (hasExplicitTypeNode) continue;

    let typeText = '';
    try {
      typeText = parameter.getType().getText();
    } catch {
      continue;
    }
    if (typeText !== 'any') continue;

    const paramName = parameter.getName();
    if (!paramName) continue;

    const parameterId = parametersByMethodAndName.get(`${methodId}::${paramName}`);
    if (!parameterId) continue;

    const existing = parameterPatchById.get(parameterId);
    if (existing) {
      existing.columns['is_implicit_any'] = true;
    } else {
      parameterPatchById.set(parameterId, {
        entity_id: parameterId,
        entity_type: 'parameter',
        columns: { is_implicit_any: true },
      });
    }
  }
}

