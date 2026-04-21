/**
 * Run-level metadata for a single invocation of the analysis pipeline.
 * Used for baseline comparison and trend tracking across runs.
 */
export interface IAnalysisSnapshotCreateDTO {
  id: string;
  package_id: string;
  created_at?: string;
  analyzer_versions_json?: string;
  config_json?: string;
  duration_ms?: number;
}

export interface IAnalysisSnapshotRow {
  id: string;
  package_id: string;
  created_at: string;
  analyzer_versions_json: string | null;
  config_json: string | null;
  duration_ms: number | null;
}
