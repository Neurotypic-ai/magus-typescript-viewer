/**
 * DocumentationAnalyzer
 *
 * Computes JSDoc coverage and throws/deprecated/see/example/param/returns tag
 * counts per module and emits per-entity stats patches so downstream joins can
 * mark classes/interfaces/functions/methods as documented.
 *
 * Uses ts-morph for AST traversal. Because ts-morph is an optional/heavy
 * dependency (installed in parallel, lazy-loaded by the pipeline), this module
 * uses a type-only import for its type surface and a dynamic runtime import
 * only to call `Node.isXxx` predicates. All node inputs are reached via
 * `ctx.project`, which the pipeline supplies when available.
 *
 * Only *exported* declarations are counted toward docCoverage — private helpers
 * aren't part of a package's public contract and don't penalize the score.
 */
import type {
  ClassDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  Node as TsMorphNode,
  Project,
  SourceFile,
} from 'ts-morph';

import type { IEntityMetricCreateDTO } from '../../../shared/types/dto/EntityMetricDTO';
import type { IModuleCreateDTO } from '../../../shared/types/dto/ModuleDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
  EntityStatsPatch,
} from '../types';
import {
  generateClassUUID,
  generateEntityMetricUUID,
  generateFunctionUUID,
  generateInterfaceUUID,
  generateMethodUUID,
} from '../../utils/uuid';

/** JSDoc tags we explicitly track. Any other tags are ignored. */
const TRACKED_TAGS = new Set(['param', 'returns', 'return', 'throws', 'example', 'deprecated', 'see']);

/** Normalize a file path for cross-platform comparisons. */
function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}

/**
 * Resolve a ts-morph SourceFile to the parseResult module it corresponds to.
 * Matches via normalized path equality, or endsWith in either direction when
 * the roots differ (ts-morph can emit absolute paths that include realpath
 * resolutions while parseResult stores the original glob-discovered filename).
 */
function findModuleForSourceFile(
  sourceFile: SourceFile,
  modules: IModuleCreateDTO[]
): IModuleCreateDTO | null {
  const filePath = normalizePath(sourceFile.getFilePath());
  for (const mod of modules) {
    const modPath = normalizePath(mod.source.filename);
    if (modPath === filePath) return mod;
    if (modPath.endsWith(filePath) || filePath.endsWith(modPath)) return mod;
  }
  return null;
}

/** Per-module accumulators used while walking source files. */
interface ModuleDocStats {
  totalExportedFunctions: number;
  documentedFunctions: number;
  jsdocCount: number;
  throwsCount: number;
  deprecatedCount: number;
}

function emptyModuleStats(): ModuleDocStats {
  return {
    totalExportedFunctions: 0,
    documentedFunctions: 0,
    jsdocCount: 0,
    throwsCount: 0,
    deprecatedCount: 0,
  };
}

/** Shape of the ts-morph module we need. Kept narrow to avoid tight coupling. */
interface TsMorphRuntime {
  Node: {
    isClassDeclaration: (n: TsMorphNode | undefined) => n is ClassDeclaration;
    isInterfaceDeclaration: (n: TsMorphNode | undefined) => n is InterfaceDeclaration;
    isFunctionDeclaration: (n: TsMorphNode | undefined) => n is FunctionDeclaration;
    isMethodDeclaration: (n: TsMorphNode | undefined) => n is MethodDeclaration;
  };
}

/**
 * Dynamically import ts-morph at runtime. The computed specifier prevents
 * TypeScript from trying to bundle ts-morph at build time; the caller already
 * ensured `ctx.project` is non-null, so the dependency is guaranteed to be
 * installed by the time we reach here.
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

export class DocumentationAnalyzer implements Analyzer {
  public id = 'documentation';
  public category: AnalyzerCategory = 'documentation';
  public requires: AnalyzerCapability[] = ['tsMorph'];

  public enabled(config: AnalysisConfig): boolean {
    return config.deep ?? false;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { project, parseResult, packageId, snapshotId, logger } = ctx;

    if (project === null || project === undefined) {
      return {};
    }

    const tsMorph = await loadTsMorph();
    if (tsMorph === null) {
      logger.debug('[DocumentationAnalyzer] ts-morph runtime unavailable; returning empty result.');
      return {};
    }

    const typedProject = project as Project;
    const sourceFiles = typedProject.getSourceFiles();

    const metrics: IEntityMetricCreateDTO[] = [];
    const entityStats: EntityStatsPatch[] = [];

    for (const sourceFile of sourceFiles) {
      const mod = findModuleForSourceFile(sourceFile, parseResult.modules);
      if (mod === null) {
        // File in ts-morph project but not in our parseResult — skip.
        continue;
      }

      const stats = emptyModuleStats();

      // Classes
      for (const cls of sourceFile.getClasses()) {
        if (!cls.isExported()) continue;
        const name = cls.getName();
        if (name === undefined || name === '') continue;

        const { docCount, tagCounts } = inspectJsDocs(cls);
        const hasJsDoc = docCount > 0;

        stats.totalExportedFunctions += 1;
        if (hasJsDoc) {
          stats.documentedFunctions += 1;
          stats.jsdocCount += docCount;
          stats.throwsCount += tagCounts.throws;
          stats.deprecatedCount += tagCounts.deprecated;

          entityStats.push({
            entity_id: generateClassUUID(packageId, mod.id, name),
            entity_type: 'class',
            columns: { has_jsdoc: true },
          });
        }

        // Walk class methods
        for (const method of cls.getMethods()) {
          const methodName = method.getName();
          if (methodName === '') continue;
          const { docCount: mDocs, tagCounts: mTags } = inspectJsDocs(method);
          const methodHasJsDoc = mDocs > 0;

          stats.totalExportedFunctions += 1;
          if (methodHasJsDoc) {
            stats.documentedFunctions += 1;
            stats.jsdocCount += mDocs;
            stats.throwsCount += mTags.throws;
            stats.deprecatedCount += mTags.deprecated;

            const classId = generateClassUUID(packageId, mod.id, name);
            entityStats.push({
              entity_id: generateMethodUUID(packageId, mod.id, classId, methodName),
              entity_type: 'method',
              columns: { has_jsdoc: true },
            });
          }
        }
      }

      // Interfaces
      for (const iface of sourceFile.getInterfaces()) {
        if (!iface.isExported()) continue;
        const name = iface.getName();
        if (name === '') continue;

        const { docCount, tagCounts } = inspectJsDocs(iface);
        const hasJsDoc = docCount > 0;

        stats.totalExportedFunctions += 1;
        if (hasJsDoc) {
          stats.documentedFunctions += 1;
          stats.jsdocCount += docCount;
          stats.throwsCount += tagCounts.throws;
          stats.deprecatedCount += tagCounts.deprecated;

          entityStats.push({
            entity_id: generateInterfaceUUID(packageId, mod.id, name),
            entity_type: 'interface',
            columns: { has_jsdoc: true },
          });
        }
      }

      // Top-level functions
      for (const fn of sourceFile.getFunctions()) {
        if (!fn.isExported()) continue;
        const name = fn.getName();
        if (name === undefined || name === '') continue;

        const { docCount, tagCounts } = inspectJsDocs(fn);
        const hasJsDoc = docCount > 0;

        stats.totalExportedFunctions += 1;
        if (hasJsDoc) {
          stats.documentedFunctions += 1;
          stats.jsdocCount += docCount;
          stats.throwsCount += tagCounts.throws;
          stats.deprecatedCount += tagCounts.deprecated;

          entityStats.push({
            entity_id: generateFunctionUUID(packageId, mod.id, name),
            entity_type: 'function',
            columns: { has_jsdoc: true },
          });
        }
      }

      // Emit per-module metrics
      const docCoverage =
        stats.totalExportedFunctions > 0
          ? stats.documentedFunctions / stats.totalExportedFunctions
          : 0;

      const moduleMetricEntries: { key: string; value: number }[] = [
        { key: 'documentation.docCoverage', value: docCoverage },
        { key: 'documentation.jsdocCount', value: stats.jsdocCount },
        { key: 'documentation.throwsCount', value: stats.throwsCount },
        { key: 'documentation.deprecatedCount', value: stats.deprecatedCount },
      ];

      for (const entry of moduleMetricEntries) {
        metrics.push({
          id: generateEntityMetricUUID(snapshotId, mod.id, 'module', entry.key),
          snapshot_id: snapshotId,
          package_id: packageId,
          module_id: mod.id,
          entity_id: mod.id,
          entity_type: 'module',
          metric_key: entry.key,
          metric_value: entry.value,
          metric_category: 'documentation',
        });
      }
    }

    return { metrics, entityStats };
  }
}

/** Aggregate of a node's JSDoc tag counts. */
interface TagCounts {
  param: number;
  returns: number;
  throws: number;
  example: number;
  deprecated: number;
  see: number;
}

function emptyTagCounts(): TagCounts {
  return { param: 0, returns: 0, throws: 0, example: 0, deprecated: 0, see: 0 };
}

/**
 * Inspect the JSDoc nodes attached to a node, returning the number of JSDoc
 * blocks (0 when undocumented) and aggregated counts of the tracked tags.
 */
function inspectJsDocs(
  node: ClassDeclaration | InterfaceDeclaration | FunctionDeclaration | MethodDeclaration
): { docCount: number; tagCounts: TagCounts } {
  const docs = node.getJsDocs();
  const tagCounts = emptyTagCounts();
  for (const doc of docs) {
    for (const tag of doc.getTags()) {
      const tagName = tag.getTagName();
      if (!TRACKED_TAGS.has(tagName)) continue;
      switch (tagName) {
        case 'param':
          tagCounts.param += 1;
          break;
        case 'returns':
        case 'return':
          tagCounts.returns += 1;
          break;
        case 'throws':
          tagCounts.throws += 1;
          break;
        case 'example':
          tagCounts.example += 1;
          break;
        case 'deprecated':
          tagCounts.deprecated += 1;
          break;
        case 'see':
          tagCounts.see += 1;
          break;
        default:
          break;
      }
    }
  }
  return { docCount: docs.length, tagCounts };
}
