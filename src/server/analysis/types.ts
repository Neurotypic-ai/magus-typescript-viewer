import type { ConsolaInstance } from 'consola';

import type { IArchitecturalViolationCreateDTO } from '../../shared/types/dto/ArchitecturalViolationDTO';
import type { ICallEdgeCreateDTO } from '../../shared/types/dto/CallEdgeDTO';
import type { ICodeIssueCreateDTO } from '../../shared/types/dto/CodeIssueDTO';
import type { IDependencyCycleCreateDTO } from '../../shared/types/dto/DependencyCycleDTO';
import type { IDuplicationClusterCreateDTO } from '../../shared/types/dto/DuplicationClusterDTO';
import type { IEntityMetricCreateDTO } from '../../shared/types/dto/EntityMetricDTO';
import type { ParseResult } from '../parsers/ParseResult';

/** Thresholds used to bucket raw metric values into `ok | warn | error`. */
export interface AnalysisThresholds {
  cyclomatic: { warning: number; error: number };
  cognitive: { warning: number; error: number };
  methodLines: { warning: number; error: number };
  parameters: { warning: number; error: number };
  anyDensity: { warning: number; error: number };
}

/** A single layered-architecture layer definition. */
export interface ArchitectureLayer {
  name: string;
  paths: string[];
}

/** A forbidden import direction between two layers. */
export interface ArchitectureForbiddenRule {
  from: string;
  to: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface ArchitectureConfig {
  layers: ArchitectureLayer[];
  rules: { forbidden: ArchitectureForbiddenRule }[];
}

export interface AnalysisConfig {
  thresholds: AnalysisThresholds;
  eslint: { extendsBuiltin: boolean; extraRules: Record<string, unknown> };
  architecture: ArchitectureConfig;
  exclusions: { paths: string[] };
  /** Analyzers to run; if empty, all enabled analyzers run. */
  enabledAnalyzers?: string[];
  /** Analyzers to explicitly skip (wins over enabledAnalyzers). */
  disabledAnalyzers?: string[];
  /** Whether heavy `requires: ['tsMorph']` analyzers should run. */
  deep?: boolean;
  /** Bound on concurrent per-file work. */
  maxWorkers?: number;
}

export type AnalyzerCategory =
  | 'complexity'
  | 'coupling'
  | 'typeSafety'
  | 'size'
  | 'documentation'
  | 'deadCode'
  | 'duplication'
  | 'architecture'
  | 'quality'
  | 'structure'
  | 'testing'
  | 'composite';

/** Capabilities an analyzer can require. The pipeline lazy-initializes shared resources. */
export type AnalyzerCapability = 'tsMorph' | 'eslint' | 'subprocess';

/** Shared repositories passed into analyzers so they can read cross-analyzer data. */
export interface AnalysisRepositories {
  [key: string]: unknown;
}

/** Context handed to every analyzer. */
export interface AnalyzerContext {
  parseResult: ParseResult;
  /**
   * Shared ts-morph Project, lazily created only if any analyzer declares
   * `requires: ['tsMorph']`. Otherwise null.
   */
  project: unknown | null;
  packageRoot: string;
  packageId: string;
  snapshotId: string;
  repositories: AnalysisRepositories;
  config: AnalysisConfig;
  logger: ConsolaInstance;
}

/**
 * Partial update for existing entity rows. `entity_type` selects the target table.
 * `columns` is a shallow object of column_name → value (repositories translate).
 */
export interface EntityStatsPatch {
  entity_id: string;
  entity_type: 'method' | 'function' | 'class' | 'interface' | 'parameter';
  columns: Record<string, number | string | boolean | null>;
}

/** Partial update for an existing module row. */
export interface ModuleStatsPatch {
  module_id: string;
  columns: Record<string, number | string | boolean | null>;
}

/** The bundle of data an analyzer can emit for persistence by the pipeline. */
export interface AnalyzerResult {
  metrics?: IEntityMetricCreateDTO[];
  findings?: ICodeIssueCreateDTO[];
  callEdges?: ICallEdgeCreateDTO[];
  cycles?: IDependencyCycleCreateDTO[];
  duplications?: IDuplicationClusterCreateDTO[];
  architecturalViolations?: IArchitecturalViolationCreateDTO[];
  moduleStats?: ModuleStatsPatch[];
  entityStats?: EntityStatsPatch[];
}

export interface Analyzer {
  /** Short unique id; used by --analyzers flag. */
  id: string;
  category: AnalyzerCategory;
  /** Capabilities the pipeline should provision before calling run(). */
  requires: AnalyzerCapability[];
  /** Analyzer IDs that must run before this one (pipeline orders runs accordingly). */
  dependsOn?: string[];
  /** Whether the analyzer should run given current config (fast opt-outs). */
  enabled(config: AnalysisConfig): boolean;
  run(ctx: AnalyzerContext): Promise<AnalyzerResult>;
}

/** Default thresholds used when a project doesn't provide its own config. */
export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  cyclomatic: { warning: 10, error: 20 },
  cognitive: { warning: 15, error: 30 },
  methodLines: { warning: 50, error: 100 },
  parameters: { warning: 5, error: 8 },
  anyDensity: { warning: 0.1, error: 0.3 },
};

export const DEFAULT_ARCHITECTURE: ArchitectureConfig = {
  layers: [
    { name: 'client', paths: ['src/client/**'] },
    { name: 'server', paths: ['src/server/**'] },
    { name: 'shared', paths: ['src/shared/**'] },
  ],
  rules: [
    { forbidden: { from: 'server', to: 'client', severity: 'error' } },
    { forbidden: { from: 'shared', to: 'client', severity: 'warning' } },
    { forbidden: { from: 'shared', to: 'server', severity: 'warning' } },
  ],
};

export function createDefaultConfig(): AnalysisConfig {
  return {
    thresholds: { ...DEFAULT_THRESHOLDS },
    eslint: { extendsBuiltin: true, extraRules: {} },
    architecture: { layers: [...DEFAULT_ARCHITECTURE.layers], rules: [...DEFAULT_ARCHITECTURE.rules] },
    exclusions: { paths: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'] },
  };
}
