import { createLogger } from '../../shared/utils/logger';
import { buildImportGraph } from './import-graph';
import { detectCommunities, findArticulationPoints, findStronglyConnectedComponents } from './graph-algorithms';

import type { DatabaseRow, IDatabaseAdapter } from '../db/adapter/IDatabaseAdapter';
import type { ImportGraph } from './import-graph';
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

function inferExternalPackageName(source: string): string | undefined {
  if (!source || source.startsWith('.') || source.startsWith('/') || source.startsWith('@/') || source.startsWith('src/')) {
    return undefined;
  }
  if (source.startsWith('@')) {
    const parts = source.split('/');
    const scope = parts[0];
    const name = parts[1];
    return scope && name ? `${scope}/${name}` : undefined;
  }
  return source.split('/')[0] ?? undefined;
}

// ── InsightEngine ───────────────────────────────────────────────────────────

export class InsightEngine {
  private readonly adapter: IDatabaseAdapter;
  private readonly logger = createLogger('InsightEngine');

  constructor(adapter: IDatabaseAdapter) {
    this.adapter = adapter;
  }

  async compute(packageId?: string): Promise<InsightReport> {
    const graph = await buildImportGraph(this.adapter, packageId);

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
      Promise.resolve(this.bridgeModules(graph)),
      Promise.resolve(this.clusterDetection(graph)),
      this.unusedExports(packageId),
      this.interfaceSegregationViolations(packageId),
      this.missingReturnTypes(packageId),
      this.asyncBoundaryMismatches(packageId),
    ]);

    const insights: InsightResult[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        insights.push(...r.value);
      } else {
        this.logger.warn('Insight computation failed:', r.reason);
      }
    }

    const summary = { critical: 0, warning: 0, info: 0 };
    for (const i of insights) summary[i.severity]++;

    const healthScore = Math.max(0, 100 - summary.critical * 5 - summary.warning * 2);

    return { packageId, computedAt: new Date().toISOString(), healthScore, summary, insights };
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
    const rows = await this.adapter.query<ExportRow>(
      `SELECT c.id as id, c.name as name, c.module_id as module_id
       FROM classes c
       WHERE NOT EXISTS (
         SELECT 1 FROM exports e WHERE e.module_id = c.module_id AND e.name = c.name
       ) ${wherePackage('c', packageId)}
       UNION ALL
       SELECT f.id as id, f.name as name, f.module_id as module_id
       FROM functions f
       WHERE NOT EXISTS (
         SELECT 1 FROM exports e WHERE e.module_id = f.module_id AND e.name = f.name
       ) AND (f.is_exported = FALSE OR f.is_exported = 'false' OR f.is_exported = '0')
       ${wherePackage('f', packageId)}`,
      [...pkgParams(packageId), ...pkgParams(packageId)],
    );

    const entities: InsightEntity[] = rows.map((row) => ({
      id: row.id,
      kind: 'class' as const,
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
    for (const row of rows) {
      const typeOnly = num(row.type_only_count);
      const total = num(row.total_count);
      entities.push({
        id: row.id,
        kind: 'module',
        name: row.name,
        detail: `${s(typeOnly)}/${s(total)} imports are type-only`,
      });
    }

    if (entities.length === 0) return [];
    return [
      this.make(
        'type-only-dependencies',
        'api-surface',
        'info',
        'Type-Only Dependencies',
        `${s(entities.length)} modules have type-only imports (candidates for import type)`,
        entities,
      ),
    ];
  }

  // ── 13. Orphaned Modules ────────────────────────────────────────────────

  private orphanedModules(graph: ImportGraph): InsightResult[] {
    const entities: InsightEntity[] = [];
    for (const id of graph.nodeIds) {
      const outDegree = graph.adjacency.get(id)?.size ?? 0;
      const inDegree = graph.reverseAdjacency.get(id)?.size ?? 0;
      if (outDegree === 0 && inDegree === 0) {
        entities.push({
          id,
          kind: 'module',
          name: graph.modules.get(id)?.name ?? id,
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

  private bridgeModules(graph: ImportGraph): InsightResult[] {
    const points = findArticulationPoints(graph.adjacency);
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

  private clusterDetection(graph: ImportGraph): InsightResult[] {
    if (graph.nodeIds.size < 3) return [];

    const labels = detectCommunities(graph.adjacency);

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

  private async unusedExports(packageId?: string): Promise<InsightResult[]> {
    const allExports = await this.adapter.query<ExportRow>(
      `SELECT id, name, module_id FROM exports WHERE 1=1 ${wherePackage('exports', packageId)}`,
      pkgParams(packageId),
    );
    if (allExports.length === 0) return [];

    const allImports = await this.adapter.query<ImportSpecRow>(
      `SELECT id, module_id, source, specifiers_json FROM imports WHERE specifiers_json IS NOT NULL`,
      [],
    );

    // Parse all imported names
    const importedNames = new Set<string>();
    for (const imp of allImports) {
      const json = imp.specifiers_json;
      if (!json) continue;
      try {
        const specs = JSON.parse(json) as { imported?: string }[];
        if (Array.isArray(specs)) {
          for (const spec of specs) {
            if (spec.imported) importedNames.add(spec.imported);
          }
        }
      } catch {
        // skip malformed JSON
      }
    }

    // Find exports not referenced by any import
    const entities: InsightEntity[] = [];
    for (const exp of allExports) {
      if (!importedNames.has(exp.name)) {
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
    for (const row of rows) {
      const members = num(row.member_count);
      const implementors = num(row.implementor_count);
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
        'warning',
        'Large Interfaces',
        `${s(entities.length)} interfaces have ${s(T.INTERFACE_SEGREGATION_MIN)}+ members (potential ISP violation)`,
        entities,
      ),
    ];
  }

  // ── 19. Missing Return Types ────────────────────────────────────────────

  private async missingReturnTypes(packageId?: string): Promise<InsightResult[]> {
    const rows = await this.adapter.query<MissingReturnRow>(
      `SELECT id, name, module_id, 'function' as entity_type
       FROM functions
       WHERE has_explicit_return_type = FALSE ${wherePackage('functions', packageId)}
       UNION ALL
       SELECT id, name, module_id, 'method' as entity_type
       FROM methods
       WHERE has_explicit_return_type = FALSE ${wherePackage('methods', packageId)}`,
      [...pkgParams(packageId), ...pkgParams(packageId)],
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
