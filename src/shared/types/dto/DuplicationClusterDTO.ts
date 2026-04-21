/**
 * A single fragment (location) participating in a duplication cluster.
 * Serialized within `fragments_json`.
 */
export interface DuplicationFragment {
  module_id: string | null;
  file_path: string;
  start_line: number;
  end_line: number;
}

/**
 * A cluster of duplicated code fragments sharing a common token fingerprint.
 */
export interface IDuplicationClusterCreateDTO {
  id: string;
  package_id: string;
  token_count: number;
  line_count: number;
  fragment_count: number;
  fingerprint: string;
  fragments_json: string;
}

export interface IDuplicationClusterRow {
  id: string;
  package_id: string;
  token_count: number;
  line_count: number;
  fragment_count: number;
  fingerprint: string;
  fragments_json: string;
  created_at: string;
}
