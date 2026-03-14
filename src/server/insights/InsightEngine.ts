import { createLogger } from '../../shared/utils/logger';
import { buildImportGraph } from './import-graph';
import { detectCommunities, findArticulationPoints, findStronglyConnectedComponents, toUndirected } from './graph-algorithms';
import { shouldSuppressInsight } from './insightignore';
import { enrichWithSuggestions } from './refactoring-suggestions';

import type { DatabaseRow, IDatabaseAdapter } from '../db/adapter/IDatabaseAdapter';
import type { ImportGraph } from './import-graph';
import type { InsightIgnoreRules } from './insightignore';
import type { InsightCategory, InsightEntity, InsightKind, InsightReport, InsightResult, InsightSeverity } from './types';

// ── Thresholds ──────────────────────────────────────────────────────────────

const T = {
  GOD_CLASS_WARNING: 15,
  GOD_CLASS_CRITICAL: 20,
  LONG_PARAMS_WARNING: 4,
  LONG_PARAMS_CRITICAL: 6,
  MODULE_SIZE_WARNING: 300,
  MODULE_SIZE_CRITICAL: 500,
  DEEP_INHERITANCE_WARNING: 3,
  DEEP_INHERITANCE_CRITICAL: 5,
  LEAKY_RATIO: 0.8,
  LEAKY_MIN_MEMBERS: 5,
  FAN_IN: 10,
  FAN_OUT: 10,
  HUB_DEGREE: 15,
  EXTERNAL_DEPS: 8,
  INTERFACE_SEGREGATION_MIN: 7,
  INTERFACE_SEGREGATION_CRITICAL: 15,
  DEPENDENCY_DEPTH_WARNING: 5,
  DEPENDENCY_DEPTH_CRITICAL: 8,
  RE_EXPORT_CHAIN_MIN: 3,
  COMPLEXITY_HOTSPOT_MIN: 3,
} as const;

// ── Row types for SQL results ───────────────────────────────────────────────

interface CountRow extends DatabaseRow {
  name: string;
  module_id: string;
  cnt: number | string;
}

interface GodClassRow extends DatabaseRow {
  name: string;
  module_id: string;
  method_count: number | string;
  property_count: number | string;
}

interface DepthRow extends DatabaseRow {
  name: string;
  module_id: string;
  max_depth: number | string;
}

interface LeakyRow extends DatabaseRow {
  name: string;
  module_id: string;
  public_count: number | string;
  total_count: number | string;
}

interface ExportRow extends DatabaseRow {
  name: string;
  module_id: string;
  entity_type?: string;
}

interface ImportSpecRow extends DatabaseRow {
  module_id: string;
  source: string;
  specifiers_json: string | null;
}

interface MissingReturnRow extends DatabaseRow {
  name: string;
  module_id: string;
  entity_type: string;
}

interface AsyncMismatchRow extends DatabaseRow {
  source_symbol_name: string;
  target_symbol_name: string;
  module_id: string;
}

interface TypeOnlyRow extends DatabaseRow {
  name: string;
  type_only_count: number | string;
  total_count: number | string;
}

interface InterfaceRow extends DatabaseRow {
  name: string;
  module_id: string;
  member_count: number | string;
  implementor_count: number | string;
}

interface ExternalImportRow extends DatabaseRow {
  module_id: string;
  module_name: string;
  source: string;
}

interface DuplicateExportRow extends DatabaseRow {
  name: string;
  module_count: number | string;
}

interface MethodNameRow extends DatabaseRow {
  parent_id: string;
  parent_name: string;
  module_id: string;
  method_name: string;
}

interface AbstractNoImplRow extends DatabaseRow {
  name: string;
  module_id: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function num(v: number | string): number {
  return typeof v === 'string' ? Number(v) : v;
}

function s(v: number): string {
  return v.toString();
}

function wherePackage(alias: string, packageId?: string): string {
  return packageId ? `AND ${alias}.package_id = ?` : '';
}

function pkgParams(packageId?: string): string[] {
  return packageId ? [packageId] : [];
}

const externalPackageNameCache = new Map<string, string | undefined>();

function inferExternalPackageName(source: string): string | undefined {
  const cached = externalPackageNameCache.get(source);
  if (cached !== undefined) return cached;
  if (externalPackageNameCache.has(source)) return undefined;

  let result: string | undefined;
  if (!source || source.startsWith('.') || source.startsWith('/') || source.startsWith('@/') || source.startsWith('src/')) {
    result = undefined;
  } else if (source.startsWith('@')) {
    const parts = source.split('/');
    const scope = parts[0];
    const name = parts[1];
    result = scope && name ? `${scope}/${name}` : undefined;
  } else {
    result = source.split('/')[0] ?? undefined;
  }

  externalPackageNameCache.set(source, result);
  return result;
}

// ── InsightEngine ───────────────────────────────────────────────────────────

export class InsightEngine {
  private readonly adapter: IDatabaseAdapter;
  private readonly logger = createLogger('InsightEngine');
  private readonly ignoreRules: InsightIgnoreRules | undefined;

  constructor(adapter: IDatabaseAdapter, ignoreRules?: InsightIgnoreRules) {
    this.adapter = adapter;
    this.ignoreRules = ignoreRules;
  }

  async compute(packageId?: string): Promise<InsightReport> {
    const graph = await buildImportGraph(this.adapter, packageId);
    const undirected = toUndirected(graph.adjacency);

    const results = await Promise.allSettled([
      Promise.resolve(this.circularImports(graph)),
      Promise.resolve(this.importFanIn(graph)),
      Promise.resolve(this.importFanOut(graph)),
      this.heavyExternalDependencies(packageId),
      this.godClasses(packageId),
      this.longParameterLists(packageId),
      this.moduleSize(packageId),
      this.deepInheritance(packageId),
      this.leakyEncapsulation(packageId),
      Promise.resolve(this.barrelFileDepth(graph)),
      this.unexportedEntities(packageId),
      this.typeOnlyDependencies(packageId),
      Promise.resolve(this.orphanedModules(graph)),
      Promise.resolve(this.hubModules(graph)),
      Promise.resolve(this.bridgeModules(graph, undirected)),
      Promise.resolve(this.clusterDetection(graph, undirected)),
      this.unusedExports(graph, packageId),
      this.interfaceSegregationViolations(packageId),
      this.missingReturnTypes(packageId),
      this.asyncBoundaryMismatches(packageId),
      Promise.resolve(this.layeringViolations(graph)),
      Promise.resolve(this.dependencyDepth(graph)),
      Promise.resolve(this.reExportChains(graph)),
      this.duplicateExports(packageId),
      this.namingInconsistency(packageId),
      this.abstractNoImpl(packageId),
      Promise.resolve(this.packageCoupling(graph)),
    ]);

    let insights: InsightResult[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        insights.push(...r.value);
      } else {
        this.logger.warn('Insight computation failed:', r.reason);
      }
    }

    // Post-processing: complexity hotspots run on already-computed insights
    const hotspots = this.complexityHotspots(insights);
    insights.push(...hotspots);

    // Filter out suppressed insights before scoring
    const rules = this.ignoreRules;
    if (rules) {
      insights = insights.filter((i) => !shouldSuppressInsight(rules, i));
    }

    // Enrich insights with refactoring suggestions
    const enrichedInsights = enrichWithSuggestions(insights, graph);

    const summary = { critical: 0, warning: 0, info: 0 };
    for (const i of enrichedInsights) summary[i.severity]++;

    const healthScore = Math.max(0, 100 - summary.critical * 5 - summary.warning * 2);

    return { packageId, computedAt: new Date().toISOString(), healthScore, summary, insights: enrichedInsights };
  }

  // ── 1. Circular Imports ─────────────────────────────────────────────────

  private circularImports(graph: ImportGraph): InsightResult[] {
    const sccs = findStronglyConnectedComponents(graph.adjacency);
    return sccs.map((cycle) => {
      const entities: InsightEntity[] = cycle.map((id) => ({
        id,
        kind: 'module' as const,
        name: graph.modules.get(id)?.name ?? id,
      }));
      return this.make(
        'circular-imports',
        'dependency-health',
        'critical',
        'Circular Import Detected',
        `${s(cycle.length)} modules form an import cycle`,
        entities,
        cycle.length,
      );
    });
  }

  // ── 2. Import Fan-in ────────────────────────────────────────────────────

  private importFanIn(graph: ImportGraph): InsightResult[] {
    const entities: InsightEntity[] = [];
    let maxFanIn = 0;
    for (const [id, importers] of graph.reverseAdjacency) {
      if (importers.size >= T.FAN_IN) {
        maxFanIn = Math.max(maxFanIn, importers.size);
        entities.push({
          id,
          kind: 'module',
          name: graph.modules.get(id)?.name ?? id,
          detail: `imported by ${s(importers.size)} modules`,
        });
      }
    }
    if (entities.length === 0) return [];
    return [
      this.make(
        'import-fan-in',
        'dependency-health',
        'warning',
        'High Import Fan-in',
        `${s(entities.length)} modules are imported by ${s(T.FAN_IN)}+ other modules`,
        entities,
        maxFanIn,
        T.FAN_IN,
      ),
    ];
  }

  // ── 3. Import Fan-out ───────────────────────────────────────────────────

  private importFanOut(graph: ImportGraph): InsightResult[] {
    const entities: InsightEntity[] = [];
    let maxFanOut = 0;
    for (const [id, deps] of graph.adjacency) {
      if (deps.size >= T.FAN_OUT) {
        maxFanOut = Math.max(maxFanOut, deps.size);
        entities.push({
          id,
          kind: 'module',
          name: graph.modules.get(id)?.name ?? id,
          detail: `imports ${s(deps.size)} modules`,
        });
      }
    }
    if (entities.length === 0) return [];
    return [
      this.make(
        'import-fan-out',
        'dependency-health',
        'warning',
        'High Import Fan-out',
        `${s(entities.length)} modules import ${s(T.FAN_OUT)}+ other modules`,
        entities,
        maxFanOut,
        T.FAN_OUT,
      ),
    ];
  }

  // ── 4. Heavy External Dependencies ──────────────────────────────────────

  private async heavyExternalDependencies(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<ExternalImportRow>(
      `SELECT i.id as id, i.module_id as module_id, m.name as module_name, i.source as source
       FROM imports i
       JOIN modules m ON m.id = i.module_id
       WHERE i.source NOT LIKE '.%' AND i.source NOT LIKE '/%'
         AND i.source NOT LIKE '@/%' AND i.source NOT LIKE 'src/%'
         ${wherePackage('i', packageId)}`,
      pkgParams(packageId),
    );

    // Group by module, count distinct external packages
    const byModule = new Map<string, { name: string; packages: Set<string> }>();
    for (const row of rows) {
      const modId = row.module_id;
      const pkg = inferExternalPackageName(row.source);
      if (!pkg) continue;
      let entry = byModule.get(modId);
      if (!entry) {
        entry = { name: row.module_name, packages: new Set() };
        byModule.set(modId, entry);
      }
      entry.packages.add(pkg);
    }

    const entities: InsightEntity[] = [];
    let maxCount = 0;
    for (const [id, entry] of byModule) {
      if (entry.packages.size >= T.EXTERNAL_DEPS) {
        maxCount = Math.max(maxCount, entry.packages.size);
        entities.push({
          id,
          kind: 'module',
          name: entry.name,
          detail: `${s(entry.packages.size)} external packages`,
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'heavy-external-dependency',
        'dependency-health',
        'warning',
        'Heavy External Dependencies',
        `${s(entities.length)} modules depend on ${s(T.EXTERNAL_DEPS)}+ external packages`,
        entities,
        maxCount,
        T.EXTERNAL_DEPS,
      ),
    ];
  }

  // ── 5. God Class ────────────────────────────────────────────────────────

  private async godClasses(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<GodClassRow>(
      `SELECT c.id as id, c.name as name, c.module_id as module_id,
         (SELECT COUNT(*) FROM methods WHERE parent_id = c.id AND parent_type = 'class') as method_count,
         (SELECT COUNT(*) FROM properties WHERE parent_id = c.id AND parent_type = 'class') as property_count
       FROM classes c
       WHERE 1=1 ${wherePackage('c', packageId)}`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    let worstSeverity: InsightSeverity = 'warning';
    let maxTotal = 0;
    for (const row of rows) {
      const methods = num(row.method_count);
      const props = num(row.property_count);
      const total = methods + props;
      if (total >= T.GOD_CLASS_WARNING) {
        maxTotal = Math.max(maxTotal, total);
        if (total >= T.GOD_CLASS_CRITICAL) worstSeverity = 'critical';
        entities.push({
          id: row.id,
          kind: 'class',
          name: row.name,
          moduleId: row.module_id,
          detail: `${s(methods)} methods, ${s(props)} properties`,
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'god-class',
        'structural-complexity',
        worstSeverity,
        'God Class Detected',
        `${s(entities.length)} classes have ${s(T.GOD_CLASS_WARNING)}+ members`,
        entities,
        maxTotal,
        T.GOD_CLASS_WARNING,
      ),
    ];
  }

  // ── 6. Long Parameter Lists ─────────────────────────────────────────────

  private async longParameterLists(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<CountRow>(
      `SELECT m.id as id, m.name as name, m.module_id as module_id, COUNT(p.id) as cnt
       FROM methods m
       JOIN parameters p ON p.method_id = m.id
       WHERE 1=1 ${wherePackage('m', packageId)}
       GROUP BY m.id, m.name, m.module_id
       HAVING COUNT(p.id) >= ${s(T.LONG_PARAMS_WARNING)}`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    let worstSeverity: InsightSeverity = 'warning';
    let maxCount = 0;
    for (const row of rows) {
      const count = num(row.cnt);
      maxCount = Math.max(maxCount, count);
      if (count >= T.LONG_PARAMS_CRITICAL) worstSeverity = 'critical';
      entities.push({
        id: row.id,
        kind: 'method',
        name: row.name,
        moduleId: row.module_id,
        detail: `${s(count)} parameters`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'long-parameter-lists',
        'structural-complexity',
        worstSeverity,
        'Long Parameter Lists',
        `${s(entities.length)} methods have ${s(T.LONG_PARAMS_WARNING)}+ parameters`,
        entities,
        maxCount,
        T.LONG_PARAMS_WARNING,
      ),
    ];
  }

  // ── 7. Module Size ──────────────────────────────────────────────────────

  private async moduleSize(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<CountRow>(
      `SELECT id, name, '' as module_id, line_count as cnt
       FROM modules
       WHERE line_count > ${s(T.MODULE_SIZE_WARNING)}
         ${wherePackage('modules', packageId)}
       ORDER BY line_count DESC`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    let worstSeverity: InsightSeverity = 'warning';
    let maxSize = 0;
    for (const row of rows) {
      const lines = num(row.cnt);
      maxSize = Math.max(maxSize, lines);
      if (lines > T.MODULE_SIZE_CRITICAL) worstSeverity = 'critical';
      entities.push({
        id: row.id,
        kind: 'module',
        name: row.name,
        detail: `${s(lines)} lines`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'module-size',
        'structural-complexity',
        worstSeverity,
        'Large Module',
        `${s(entities.length)} modules exceed ${s(T.MODULE_SIZE_WARNING)} lines`,
        entities,
        maxSize,
        T.MODULE_SIZE_WARNING,
      ),
    ];
  }

  // ── 8. Deep Inheritance ─────────────────────────────────────────────────

  private async deepInheritance(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<DepthRow>(
      `WITH RECURSIVE chain AS (
         SELECT class_id, parent_id, 1 as depth FROM class_extends
         UNION ALL
         SELECT ch.class_id, ce.parent_id, ch.depth + 1
         FROM chain ch
         JOIN class_extends ce ON ce.class_id = ch.parent_id
         WHERE ch.depth < 10
       )
       SELECT c.id as id, c.name as name, c.module_id as module_id, MAX(ch.depth) as max_depth
       FROM chain ch
       JOIN classes c ON c.id = ch.class_id
       WHERE 1=1 ${wherePackage('c', packageId)}
       GROUP BY c.id, c.name, c.module_id
       HAVING MAX(ch.depth) >= ${s(T.DEEP_INHERITANCE_WARNING)}
       ORDER BY max_depth DESC`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    let worstSeverity: InsightSeverity = 'warning';
    let maxDepth = 0;
    for (const row of rows) {
      const depth = num(row.max_depth);
      maxDepth = Math.max(maxDepth, depth);
      if (depth >= T.DEEP_INHERITANCE_CRITICAL) worstSeverity = 'critical';
      entities.push({
        id: row.id,
        kind: 'class',
        name: row.name,
        moduleId: row.module_id,
        detail: `inheritance depth ${s(depth)}`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'deep-inheritance',
        'structural-complexity',
        worstSeverity,
        'Deep Inheritance Chain',
        `${s(entities.length)} classes have inheritance depth >= ${s(T.DEEP_INHERITANCE_WARNING)}`,
        entities,
        maxDepth,
        T.DEEP_INHERITANCE_WARNING,
      ),
    ];
  }

  // ── 9. Leaky Encapsulation ──────────────────────────────────────────────

  private async leakyEncapsulation(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<LeakyRow>(
      `SELECT c.id as id, c.name as name, c.module_id as module_id,
         SUM(CASE WHEN sub.visibility = 'public' THEN 1 ELSE 0 END) as public_count,
         COUNT(*) as total_count
       FROM classes c
       JOIN (
         SELECT parent_id, visibility FROM methods WHERE parent_type = 'class'
         UNION ALL
         SELECT parent_id, visibility FROM properties WHERE parent_type = 'class'
       ) sub ON sub.parent_id = c.id
       WHERE 1=1 ${wherePackage('c', packageId)}
       GROUP BY c.id, c.name, c.module_id
       HAVING COUNT(*) >= ${s(T.LEAKY_MIN_MEMBERS)}
         AND CAST(SUM(CASE WHEN sub.visibility = 'public' THEN 1 ELSE 0 END) AS DOUBLE) / COUNT(*) > ${T.LEAKY_RATIO.toString()}`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    for (const row of rows) {
      const pub = num(row.public_count);
      const total = num(row.total_count);
      if (total === 0) continue;
      const pct = Math.round((pub / total) * 100);
      entities.push({
        id: row.id,
        kind: 'class',
        name: row.name,
        moduleId: row.module_id,
        detail: `${s(pct)}% public (${s(pub)}/${s(total)} members)`,
      });
    }

    if (entities.length === 0) return [];
    const pctThreshold = Math.round(T.LEAKY_RATIO * 100);
    return [
      this.make(
        'leaky-encapsulation',
        'api-surface',
        'warning',
        'Leaky Encapsulation',
        `${s(entities.length)} classes expose > ${s(pctThreshold)}% public members`,
        entities,
      ),
    ];
  }

  // ── 10. Barrel File Depth ───────────────────────────────────────────────

  private barrelFileDepth(graph: ImportGraph): InsightResult[] {
    const entities: InsightEntity[] = [];
    for (const [id, meta] of graph.modules) {
      if (!meta.isBarrel) continue;
      const deps = graph.adjacency.get(id) ?? new Set();
      const barrelDeps = Array.from(deps).filter((depId) => graph.modules.get(depId)?.isBarrel);
      if (barrelDeps.length > 0) {
        entities.push({
          id,
          kind: 'module',
          name: meta.name,
          detail: `re-exports through ${s(barrelDeps.length)} other barrel files`,
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'barrel-file-depth',
        'api-surface',
        'info',
        'Nested Barrel Files',
        `${s(entities.length)} barrel files re-export through other barrel files`,
        entities,
      ),
    ];
  }

  // ── 11. Unexported Entities ─────────────────────────────────────────────

  private async unexportedEntities(packageId?: string): Promise<InsightResult[]> {
    const params = pkgParams(packageId);
    const rows = await this.adapter.query<ExportRow>(
      `SELECT c.id as id, c.name as name, c.module_id as module_id, 'class' as entity_type
       FROM classes c
       WHERE NOT EXISTS (
         SELECT 1 FROM exports e WHERE e.module_id = c.module_id AND e.name = c.name
       ) ${wherePackage('c', packageId)}
       UNION ALL
       SELECT f.id as id, f.name as name, f.module_id as module_id, 'function' as entity_type
       FROM functions f
       WHERE NOT EXISTS (
         SELECT 1 FROM exports e WHERE e.module_id = f.module_id AND e.name = f.name
       ) AND (f.is_exported = FALSE OR f.is_exported = 'false' OR f.is_exported = '0')
       ${wherePackage('f', packageId)}`,
      [...params, ...params],
    );

    const entities: InsightEntity[] = rows.map((row) => ({
      id: row.id,
      kind: (row.entity_type === 'function' ? 'function' : 'class') as InsightEntity['kind'],
      name: row.name,
      moduleId: row.module_id,
    }));

    if (entities.length === 0) return [];
    return [
      this.make(
        'unexported-entities',
        'api-surface',
        'info',
        'Unexported Entities',
        `${s(entities.length)} classes or functions are not exported from their modules`,
        entities,
      ),
    ];
  }

  // ── 12. Type-Only Dependencies ──────────────────────────────────────────

  private async typeOnlyDependencies(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<TypeOnlyRow>(
      `SELECT m.id as id, m.name as name,
         SUM(CASE WHEN i.is_type_only = TRUE THEN 1 ELSE 0 END) as type_only_count,
         COUNT(*) as total_count
       FROM modules m
       JOIN imports i ON i.module_id = m.id
       WHERE 1=1 ${wherePackage('m', packageId)}
       GROUP BY m.id, m.name
       HAVING SUM(CASE WHEN i.is_type_only = TRUE THEN 1 ELSE 0 END) > 0`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    let allTypeOnlyCount = 0;
    for (const row of rows) {
      const typeOnly = num(row.type_only_count);
      const total = num(row.total_count);
      const allTypeOnly = typeOnly === total;
      if (allTypeOnly) allTypeOnlyCount++;
      entities.push({
        id: row.id,
        kind: 'module',
        name: row.name,
        detail: allTypeOnly
          ? `all ${s(total)} imports are type-only — consider using \`import type\``
          : `${s(typeOnly)}/${s(total)} imports are type-only`,
      });
    }

    if (entities.length === 0) return [];
    const severity: InsightSeverity = allTypeOnlyCount > 0 ? 'warning' : 'info';
    return [
      this.make(
        'type-only-dependencies',
        'api-surface',
        severity,
        'Type-Only Dependencies',
        allTypeOnlyCount > 0
          ? `${s(allTypeOnlyCount)} modules have only type imports (should use \`import type\`), ${s(entities.length - allTypeOnlyCount)} have a mix`
          : `${s(entities.length)} modules have type-only imports (candidates for import type)`,
        entities,
      ),
    ];
  }

  // ── 13. Orphaned Modules ────────────────────────────────────────────────

  private orphanedModules(graph: ImportGraph): InsightResult[] {
    const entryPointPatterns = /(?:^index\.[^.]+$|\.(?:test|spec|stories|story)\.[^.]+$|^(?:main|app|vite\.config|vitest\.config|eslint\.config)\.[^.]+$)/;

    const entities: InsightEntity[] = [];
    for (const id of graph.nodeIds) {
      const outDegree = graph.adjacency.get(id)?.size ?? 0;
      const inDegree = graph.reverseAdjacency.get(id)?.size ?? 0;
      if (outDegree === 0 && inDegree === 0) {
        const meta = graph.modules.get(id);
        const name = meta?.name ?? id;

        // Skip known entry points, test files, and config files
        if (entryPointPatterns.test(name)) continue;

        entities.push({
          id,
          kind: 'module',
          name,
          detail: 'no imports and not imported by any module',
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'orphaned-modules',
        'connectivity',
        'warning',
        'Orphaned Modules',
        `${s(entities.length)} modules have no import connections`,
        entities,
      ),
    ];
  }

  // ── 14. Hub Modules ─────────────────────────────────────────────────────

  private hubModules(graph: ImportGraph): InsightResult[] {
    const entities: InsightEntity[] = [];
    let maxDegree = 0;
    for (const id of graph.nodeIds) {
      const outDeg = graph.adjacency.get(id)?.size ?? 0;
      const inDeg = graph.reverseAdjacency.get(id)?.size ?? 0;
      const total = outDeg + inDeg;
      if (total >= T.HUB_DEGREE) {
        maxDegree = Math.max(maxDegree, total);
        entities.push({
          id,
          kind: 'module',
          name: graph.modules.get(id)?.name ?? id,
          detail: `degree ${s(total)} (in: ${s(inDeg)}, out: ${s(outDeg)})`,
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'hub-modules',
        'connectivity',
        'info',
        'Hub Modules',
        `${s(entities.length)} modules have combined degree >= ${s(T.HUB_DEGREE)}`,
        entities,
        maxDegree,
        T.HUB_DEGREE,
      ),
    ];
  }

  // ── 15. Bridge Modules ──────────────────────────────────────────────────

  private bridgeModules(graph: ImportGraph, undirected: Map<string, Set<string>>): InsightResult[] {
    const points = findArticulationPoints(graph.adjacency, undirected);
    const entities: InsightEntity[] = Array.from(points).map((id) => ({
      id,
      kind: 'module' as const,
      name: graph.modules.get(id)?.name ?? id,
      detail: 'removing this module disconnects the import graph',
    }));

    if (entities.length === 0) return [];
    return [
      this.make(
        'bridge-modules',
        'connectivity',
        'warning',
        'Bridge Modules',
        `${s(entities.length)} modules are articulation points in the import graph`,
        entities,
      ),
    ];
  }

  // ── 16. Cluster Detection ───────────────────────────────────────────────

  private clusterDetection(graph: ImportGraph, undirected: Map<string, Set<string>>): InsightResult[] {
    if (graph.nodeIds.size < 3) return [];

    const labels = detectCommunities(graph.adjacency, 10, undirected);

    // Group by community label
    const communities = new Map<number, string[]>();
    for (const [nodeId, label] of labels) {
      let arr = communities.get(label);
      if (!arr) {
        arr = [];
        communities.set(label, arr);
      }
      arr.push(nodeId);
    }

    // Only report clusters with > 1 member
    const results: InsightResult[] = [];
    let clusterIndex = 0;
    for (const members of communities.values()) {
      if (members.length <= 1) continue;
      clusterIndex++;
      const entities: InsightEntity[] = members.map((id) => ({
        id,
        kind: 'module' as const,
        name: graph.modules.get(id)?.name ?? id,
      }));
      results.push(
        this.make(
          'cluster-detection',
          'connectivity',
          'info',
          `Module Cluster #${s(clusterIndex)}`,
          `${s(members.length)} modules form a tightly connected cluster`,
          entities,
          members.length,
        ),
      );
    }

    return results;
  }

  // ── 17. Unused Exports ──────────────────────────────────────────────────

  private async unusedExports(graph: ImportGraph, packageId?: string): Promise<InsightResult[]> {
    const allExports = await this.adapter.query<ExportRow>(
      `SELECT id, name, module_id FROM exports WHERE 1=1 ${wherePackage('exports', packageId)}`,
      pkgParams(packageId),
    );
    if (allExports.length === 0) return [];

    const allImports = await this.adapter.query<ImportSpecRow>(
      `SELECT id, module_id, source, specifiers_json FROM imports
       WHERE specifiers_json IS NOT NULL ${wherePackage('imports', packageId)}`,
      pkgParams(packageId),
    );

    // Build set of (target_module_id, imported_name) pairs for precise matching
    const importedPairs = new Set<string>();
    for (const imp of allImports) {
      const json = imp.specifiers_json;
      if (!json) continue;

      // Resolve the import source to a target module ID using the graph's adjacency
      // The source module's outgoing edges tell us which modules it imports
      const targetModuleIds = graph.adjacency.get(imp.module_id);
      if (!targetModuleIds || targetModuleIds.size === 0) continue;

      try {
        const specs = JSON.parse(json) as { imported?: string }[];
        if (Array.isArray(specs)) {
          for (const spec of specs) {
            if (spec.imported) {
              // Associate imported name with each possible target module
              for (const targetId of targetModuleIds) {
                importedPairs.add(`${targetId}::${spec.imported}`);
              }
            }
          }
        }
      } catch {
        // skip malformed JSON
      }
    }

    // Find exports not referenced by any import targeting their module
    const entities: InsightEntity[] = [];
    for (const exp of allExports) {
      const key = `${exp.module_id}::${exp.name}`;
      if (!importedPairs.has(key)) {
        entities.push({
          id: exp.id,
          kind: 'module',
          name: exp.name,
          moduleId: exp.module_id,
          detail: 'exported but never imported',
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'unused-exports',
        'maintenance',
        'warning',
        'Unused Exports',
        `${s(entities.length)} exported symbols are not imported by any module`,
        entities,
      ),
    ];
  }

  // ── 18. Interface Segregation Violations ────────────────────────────────

  private async interfaceSegregationViolations(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<InterfaceRow>(
      `SELECT id, name, module_id, member_count, implementor_count FROM (
         SELECT i.id as id, i.name as name, i.module_id as module_id,
           (SELECT COUNT(*) FROM methods WHERE parent_id = i.id AND parent_type = 'interface') +
           (SELECT COUNT(*) FROM properties WHERE parent_id = i.id AND parent_type = 'interface') as member_count,
           (SELECT COUNT(*) FROM class_implements ci WHERE ci.interface_id = i.id) as implementor_count
         FROM interfaces i
         WHERE 1=1 ${wherePackage('i', packageId)}
       ) sub
       WHERE member_count >= ${s(T.INTERFACE_SEGREGATION_MIN)} AND implementor_count > 0`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    let worstSeverity: InsightSeverity = 'warning';
    let maxMembers = 0;
    for (const row of rows) {
      const members = num(row.member_count);
      const implementors = num(row.implementor_count);
      maxMembers = Math.max(maxMembers, members);
      if (members >= T.INTERFACE_SEGREGATION_CRITICAL) worstSeverity = 'critical';
      entities.push({
        id: row.id,
        kind: 'interface',
        name: row.name,
        moduleId: row.module_id,
        detail: `${s(members)} members, implemented by ${s(implementors)} classes`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'interface-segregation-violations',
        'maintenance',
        worstSeverity,
        'Large Interfaces',
        `${s(entities.length)} interfaces have ${s(T.INTERFACE_SEGREGATION_MIN)}+ members (potential ISP violation)`,
        entities,
        maxMembers,
        T.INTERFACE_SEGREGATION_MIN,
      ),
    ];
  }

  // ── 19. Missing Return Types ────────────────────────────────────────────

  private async missingReturnTypes(packageId?: string): Promise<InsightResult[]> {
    const params = pkgParams(packageId);
    const rows = await this.adapter.query<MissingReturnRow>(
      `SELECT id, name, module_id, 'function' as entity_type
       FROM functions
       WHERE has_explicit_return_type = FALSE ${wherePackage('functions', packageId)}
       UNION ALL
       SELECT id, name, module_id, 'method' as entity_type
       FROM methods
       WHERE has_explicit_return_type = FALSE ${wherePackage('methods', packageId)}`,
      [...params, ...params],
    );

    const entities: InsightEntity[] = rows.map((row) => ({
      id: row.id,
      kind: row.entity_type === 'function' ? 'function' : 'method',
      name: row.name,
      moduleId: row.module_id,
    }));

    if (entities.length === 0) return [];
    return [
      this.make(
        'missing-return-types',
        'maintenance',
        'info',
        'Missing Return Types',
        `${s(entities.length)} functions/methods lack explicit return type annotations`,
        entities,
      ),
    ];
  }

  // ── 20. Async Boundary Mismatches ───────────────────────────────────────

  private async asyncBoundaryMismatches(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<AsyncMismatchRow>(
      `SELECT sr.id as id, sr.source_symbol_name as source_symbol_name,
         sr.target_symbol_name as target_symbol_name, sr.module_id as module_id
       FROM symbol_references sr
       JOIN methods m_source ON m_source.id = sr.source_symbol_id
       JOIN methods m_target ON m_target.id = sr.target_symbol_id
       WHERE m_source.is_async = FALSE AND m_target.is_async = TRUE
         ${wherePackage('sr', packageId)}`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = rows.map((row) => ({
      id: row.id,
      kind: 'method' as const,
      name: row.source_symbol_name,
      moduleId: row.module_id,
      detail: `sync method calls async ${row.target_symbol_name}`,
    }));

    if (entities.length === 0) return [];
    return [
      this.make(
        'async-boundary-mismatches',
        'maintenance',
        'info',
        'Async Boundary Mismatches',
        `${s(entities.length)} sync methods call async methods (potential missing await)`,
        entities,
      ),
    ];
  }

  // ── 21. Layering Violations ──────────────────────────────────────────────

  private layeringViolations(graph: ImportGraph): InsightResult[] {
    const layerMap: Record<string, number> = {
      shared: 0, utils: 0, types: 0, lib: 0,
      services: 1, stores: 1, db: 1,
      components: 2, composables: 2, views: 2,
      pages: 3, app: 3,
    };

    function getLayer(moduleId: string): number | undefined {
      const meta = graph.modules.get(moduleId);
      if (!meta) return undefined;
      const parts = meta.relativePath.split('/');
      for (const part of parts) {
        if (part in layerMap) return layerMap[part];
      }
      return undefined;
    }

    const entities: InsightEntity[] = [];
    for (const [sourceId, targets] of graph.adjacency) {
      const sourceLayer = getLayer(sourceId);
      if (sourceLayer === undefined) continue;
      for (const targetId of targets) {
        const targetLayer = getLayer(targetId);
        if (targetLayer === undefined) continue;
        if (sourceLayer < targetLayer) {
          entities.push({
            id: sourceId,
            kind: 'import',
            name: graph.modules.get(sourceId)?.name ?? sourceId,
            detail: `imports ${graph.modules.get(targetId)?.name ?? targetId} (layer ${s(sourceLayer)} → ${s(targetLayer)})`,
          });
        }
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'layering-violations',
        'dependency-health',
        'warning',
        'Layering Violations',
        `${s(entities.length)} imports violate the layered architecture`,
        entities,
      ),
    ];
  }

  // ── 22. Dependency Depth ────────────────────────────────────────────────

  private dependencyDepth(graph: ImportGraph): InsightResult[] {
    const entities: InsightEntity[] = [];
    let maxDepth = 0;
    let worstSeverity: InsightSeverity = 'info';

    for (const startId of graph.nodeIds) {
      const visited = new Map<string, number>();
      const queue: [string, number][] = [[startId, 0]];
      visited.set(startId, 0);
      let deepest = 0;

      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) break;
        const [currentId, depth] = entry;
        const neighbors = graph.adjacency.get(currentId);
        if (!neighbors) continue;
        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            const nextDepth = depth + 1;
            visited.set(neighborId, nextDepth);
            deepest = Math.max(deepest, nextDepth);
            queue.push([neighborId, nextDepth]);
          }
        }
      }

      if (deepest > T.DEPENDENCY_DEPTH_WARNING) {
        maxDepth = Math.max(maxDepth, deepest);
        if (deepest > T.DEPENDENCY_DEPTH_CRITICAL) worstSeverity = 'warning';
        entities.push({
          id: startId,
          kind: 'module',
          name: graph.modules.get(startId)?.name ?? startId,
          detail: `dependency depth ${s(deepest)}`,
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'dependency-depth',
        'dependency-health',
        worstSeverity,
        'Deep Dependency Chain',
        `${s(entities.length)} modules have transitive dependency depth > ${s(T.DEPENDENCY_DEPTH_WARNING)}`,
        entities,
        maxDepth,
        T.DEPENDENCY_DEPTH_WARNING,
      ),
    ];
  }

  // ── 23. Re-export Chains ──────────────────────────────────────────────

  private reExportChains(graph: ImportGraph): InsightResult[] {
    const results: InsightResult[] = [];

    for (const startId of graph.nodeIds) {
      const meta = graph.modules.get(startId);
      if (!meta?.isBarrel) continue;

      const chain: string[] = [startId];
      let current = startId;
      const visited = new Set<string>([startId]);

      let barrelDep: string | undefined;
      do {
        const deps = graph.adjacency.get(current);
        if (!deps) break;
        barrelDep = Array.from(deps).find(
          (depId) => graph.modules.get(depId)?.isBarrel && !visited.has(depId),
        );
        if (barrelDep) {
          visited.add(barrelDep);
          chain.push(barrelDep);
          current = barrelDep;
        }
      } while (barrelDep);

      if (chain.length >= T.RE_EXPORT_CHAIN_MIN) {
        const entities: InsightEntity[] = chain.map((id) => ({
          id,
          kind: 'module' as const,
          name: graph.modules.get(id)?.name ?? id,
        }));
        results.push(
          this.make(
            're-export-chains',
            'api-surface',
            'warning',
            'Re-export Chain',
            `${s(chain.length)} barrel files form a re-export chain: ${chain.map((id) => graph.modules.get(id)?.name ?? id).join(' → ')}`,
            entities,
            chain.length,
            T.RE_EXPORT_CHAIN_MIN,
          ),
        );
      }
    }

    return results;
  }

  // ── 24. Duplicate Exports ──────────────────────────────────────────────

  private async duplicateExports(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<DuplicateExportRow>(
      `SELECT name, COUNT(DISTINCT module_id) as module_count
       FROM exports
       WHERE 1=1 ${wherePackage('exports', packageId)}
       GROUP BY name
       HAVING COUNT(DISTINCT module_id) > 1`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = [];
    for (const row of rows) {
      const count = num(row.module_count);
      entities.push({
        id: row.name,
        kind: 'module',
        name: row.name,
        detail: `exported from ${s(count)} modules`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'duplicate-exports',
        'maintenance',
        'info',
        'Duplicate Exports',
        `${s(entities.length)} symbol${entities.length === 1 ? '' : 's'} exported from multiple modules`,
        entities,
      ),
    ];
  }

  // ── 25. Naming Inconsistency ────────────────────────────────────────────

  private async namingInconsistency(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<MethodNameRow>(
      `SELECT m.parent_id as parent_id, c.name as parent_name, m.module_id as module_id, m.name as method_name
       FROM methods m
       JOIN classes c ON c.id = m.parent_id AND m.parent_type = 'class'
       WHERE 1=1 ${wherePackage('m', packageId)}
       UNION ALL
       SELECT m.parent_id as parent_id, i.name as parent_name, m.module_id as module_id, m.name as method_name
       FROM methods m
       JOIN interfaces i ON i.id = m.parent_id AND m.parent_type = 'interface'
       WHERE 1=1 ${wherePackage('m', packageId)}`,
      [...pkgParams(packageId), ...pkgParams(packageId)],
    );

    const byParent = new Map<string, { name: string; moduleId: string; methods: string[] }>();
    for (const row of rows) {
      let entry = byParent.get(row.parent_id);
      if (!entry) {
        entry = { name: row.parent_name, moduleId: row.module_id, methods: [] };
        byParent.set(row.parent_id, entry);
      }
      entry.methods.push(row.method_name);
    }

    const isSnakeCase = (n: string): boolean => n.includes('_') && n === n.toLowerCase();
    const isCamelCase = (n: string): boolean => /^[a-z]/.test(n) && /[A-Z]/.test(n);

    const entities: InsightEntity[] = [];
    for (const [id, entry] of byParent) {
      const hasSnake = entry.methods.some(isSnakeCase);
      const hasCamel = entry.methods.some(isCamelCase);
      if (hasSnake && hasCamel) {
        entities.push({
          id,
          kind: 'class',
          name: entry.name,
          moduleId: entry.moduleId,
          detail: 'mixes camelCase and snake_case method names',
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'naming-inconsistency',
        'maintenance',
        'info',
        'Naming Inconsistency',
        `${s(entities.length)} classes/interfaces mix camelCase and snake_case method names`,
        entities,
      ),
    ];
  }

  // ── 26. Abstract Class Without Implementors ─────────────────────────────

  private async abstractNoImpl(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<AbstractNoImplRow>(
      `SELECT DISTINCT c.id as id, c.name as name, c.module_id as module_id
       FROM classes c
       JOIN methods m ON m.parent_id = c.id AND m.parent_type = 'class' AND m.is_abstract = TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM class_extends ce WHERE ce.parent_id = c.id
       ) ${wherePackage('c', packageId)}`,
      pkgParams(packageId),
    );

    const entities: InsightEntity[] = rows.map((row) => ({
      id: row.id,
      kind: 'class' as const,
      name: row.name,
      moduleId: row.module_id,
      detail: 'abstract class with no known subclasses',
    }));

    if (entities.length === 0) return [];
    return [
      this.make(
        'abstract-no-impl',
        'maintenance',
        'warning',
        'Abstract Class Without Implementors',
        `${s(entities.length)} abstract classes have no known subclasses`,
        entities,
      ),
    ];
  }

  // ── 27. Complexity Hotspots ─────────────────────────────────────────────

  private complexityHotspots(insights: InsightResult[]): InsightResult[] {
    // Count how many distinct insight types reference each module
    const moduleKinds = new Map<string, Set<InsightKind>>();
    const moduleNames = new Map<string, string>();

    for (const insight of insights) {
      for (const entity of insight.entities) {
        const moduleId = entity.moduleId ?? (entity.kind === 'module' ? entity.id : undefined);
        if (!moduleId) continue;
        let kinds = moduleKinds.get(moduleId);
        if (!kinds) {
          kinds = new Set();
          moduleKinds.set(moduleId, kinds);
        }
        kinds.add(insight.type);
        if (!moduleNames.has(moduleId)) {
          moduleNames.set(moduleId, entity.kind === 'module' ? entity.name : moduleId);
        }
      }
    }

    const entities: InsightEntity[] = [];
    let maxCount = 0;
    for (const [moduleId, kinds] of moduleKinds) {
      if (kinds.size >= T.COMPLEXITY_HOTSPOT_MIN) {
        maxCount = Math.max(maxCount, kinds.size);
        entities.push({
          id: moduleId,
          kind: 'module',
          name: moduleNames.get(moduleId) ?? moduleId,
          detail: `appears in ${s(kinds.size)} distinct insight types`,
        });
      }
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'complexity-hotspot',
        'structural-complexity',
        'warning',
        'Complexity Hotspot',
        `${s(entities.length)} modules appear in ${s(T.COMPLEXITY_HOTSPOT_MIN)}+ distinct insight types`,
        entities,
        maxCount,
        T.COMPLEXITY_HOTSPOT_MIN,
      ),
    ];
  }

  // ── 28. Package Coupling ──────────────────────────────────────────────

  private packageCoupling(graph: ImportGraph): InsightResult[] {
    // Collect all unique package IDs
    const packageIds = new Set<string>();
    for (const meta of graph.modules.values()) {
      packageIds.add(meta.packageId);
    }
    // Only relevant for multi-package codebases
    if (packageIds.size < 2) return [];

    // Count total imports per package and cross-package imports per pair
    const pairKey = (a: string, b: string): string => a < b ? `${a}||${b}` : `${b}||${a}`;
    const crossImports = new Map<string, number>();
    const pkgTotalImports = new Map<string, number>();

    for (const [sourceId, targets] of graph.adjacency) {
      const sourcePkg = graph.modules.get(sourceId)?.packageId;
      if (!sourcePkg) continue;

      for (const targetId of targets) {
        const targetPkg = graph.modules.get(targetId)?.packageId;
        if (!targetPkg) continue;

        pkgTotalImports.set(sourcePkg, (pkgTotalImports.get(sourcePkg) ?? 0) + 1);
        if (sourcePkg !== targetPkg) {
          const key = pairKey(sourcePkg, targetPkg);
          crossImports.set(key, (crossImports.get(key) ?? 0) + 1);
        }
      }
    }

    const entities: InsightEntity[] = [];
    let worstSeverity: InsightSeverity = 'info';
    let maxRatio = 0;

    for (const [key, crossCount] of crossImports) {
      const parts = key.split('||');
      const pkgA = parts[0] ?? key;
      const pkgB = parts[1] ?? key;
      const totalA = pkgTotalImports.get(pkgA) ?? 0;
      const totalB = pkgTotalImports.get(pkgB) ?? 0;
      const total = totalA + totalB;
      if (total === 0) continue;
      const ratio = crossCount / total;
      maxRatio = Math.max(maxRatio, ratio);
      if (ratio > 0.5) worstSeverity = 'warning';
      const pct = Math.round(ratio * 100);
      entities.push({
        id: key,
        kind: 'module',
        name: `${pkgA} <-> ${pkgB}`,
        detail: `${s(crossCount)} cross-package imports (${s(pct)}% of ${s(total)} total)`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'package-coupling',
        'connectivity',
        worstSeverity,
        'Package Coupling',
        `${s(entities.length)} package pairs have cross-package imports`,
        entities,
        Math.round(maxRatio * 100),
      ),
    ];
  }

  // ── Factory ─────────────────────────────────────────────────────────────

  private make(
    type: InsightKind,
    category: InsightCategory,
    severity: InsightSeverity,
    title: string,
    description: string,
    entities: InsightEntity[],
    value?: number,
    threshold?: number,
  ): InsightResult {
    return { type, category, severity, title, description, entities, value, threshold };
  }
}
