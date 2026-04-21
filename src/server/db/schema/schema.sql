-- Database Schema for TypeScript Codebase Analyzer using DuckDB native UUIDs
-- All tables use UUID for primary keys and proper foreign key references.
-- Timestamps are stored as TIMESTAMP and default to CURRENT_TIMESTAMP.
-- Note: DuckDB does not support ON DELETE CASCADE or triggers.

-- Packages table
-- package_json_deps_json stores the per-package declared dep classification
-- as JSON: { [packageName]: 'dependency' | 'devDependency' | 'peerDependency' }.
-- This lives here (rather than in the `dependencies` junction table below)
-- because external npm packages are never inserted as `packages` rows, so
-- the junction table's FK would silently reject them. Storing the scope
-- alongside the package keeps the classification attached to the workspace
-- package that declared the dep.
CREATE TABLE packages (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  path TEXT NOT NULL,
  package_json_deps_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Dependencies table (handles dependency relationships between packages)
CREATE TABLE dependencies (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL REFERENCES packages (id),
  target_id CHAR(36) NOT NULL REFERENCES packages (id),
  type TEXT NOT NULL CHECK (type IN ('dependency', 'devDependency', 'peerDependency')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (source_id, target_id, type),
  CHECK (source_id != target_id)
);

-- Modules table with enhanced file location tracking
CREATE TABLE modules (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  name TEXT NOT NULL,
  source TEXT,
  directory TEXT NOT NULL,
  filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  is_barrel BOOLEAN NOT NULL DEFAULT FALSE,
  line_count INTEGER NOT NULL DEFAULT 0,
  physical_lines INTEGER,
  logical_lines INTEGER,
  comment_lines INTEGER,
  halstead_volume DOUBLE,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Create indices for faster module lookups
CREATE INDEX idx_modules_package_id ON modules (package_id);
CREATE INDEX idx_modules_filename ON modules (filename);

-- Module Tests table to track test files
CREATE TABLE module_tests (
  id CHAR(36) PRIMARY KEY,
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  test_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Classes table with denormalized package_id and module_id
CREATE TABLE classes (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  extends_id CHAR(36),
  start_line INTEGER,
  end_line INTEGER,
  has_jsdoc BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Interfaces table with denormalized package_id and module_id
CREATE TABLE interfaces (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  extends_id CHAR(36),
  start_line INTEGER,
  end_line INTEGER,
  has_jsdoc BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Methods table with denormalized package_id, module_id, and polymorphic parent_id
CREATE TABLE methods (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  parent_id CHAR(36) NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('class', 'interface')),
  name TEXT NOT NULL,
  return_type TEXT,
  is_static BOOLEAN NOT NULL DEFAULT FALSE,
  is_abstract BOOLEAN NOT NULL DEFAULT FALSE,
  is_async BOOLEAN NOT NULL DEFAULT FALSE,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'protected')),
  has_explicit_return_type BOOLEAN NOT NULL DEFAULT FALSE,
  start_line INTEGER,
  end_line INTEGER,
  logical_lines INTEGER,
  cyclomatic INTEGER,
  cognitive INTEGER,
  max_nesting INTEGER,
  parameter_count INTEGER,
  has_jsdoc BOOLEAN,
  return_type_is_any BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Parameters table with denormalized package_id and module_id
CREATE TABLE parameters (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  method_id CHAR(36) NOT NULL REFERENCES methods (id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_optional INTEGER NOT NULL DEFAULT 0,
  is_rest INTEGER NOT NULL DEFAULT 0,
  default_value TEXT,
  type_is_any BOOLEAN,
  is_implicit_any BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Properties table with denormalized package_id, module_id, and polymorphic parent_id
CREATE TABLE properties (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  parent_id CHAR(36) NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('class', 'interface')),
  name TEXT NOT NULL,
  type TEXT,
  is_static BOOLEAN NOT NULL DEFAULT FALSE,
  is_readonly BOOLEAN NOT NULL DEFAULT FALSE,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'protected')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Imports table with denormalized package_id and module_id
CREATE TABLE imports (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  source TEXT NOT NULL,
  specifiers_json TEXT,
  is_type_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Exports table for module exports
CREATE TABLE exports (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Class implements table (many-to-many relationship)
CREATE TABLE class_implements (
  id CHAR(36) PRIMARY KEY,
  class_id CHAR(36) NOT NULL REFERENCES classes (id),
  interface_id CHAR(36) NOT NULL REFERENCES interfaces (id),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (class_id, interface_id)
);

-- Interface extends table (many-to-many relationship)
CREATE TABLE interface_extends (
  id CHAR(36) PRIMARY KEY,
  interface_id CHAR(36) NOT NULL REFERENCES interfaces (id),
  extended_id CHAR(36) NOT NULL REFERENCES interfaces (id),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (interface_id, extended_id),
  CHECK (interface_id != extended_id)
);

-- Class extends table (single inheritance)
CREATE TABLE class_extends (
  id CHAR(36) PRIMARY KEY,
  class_id CHAR(36) NOT NULL REFERENCES classes (id),
  parent_id CHAR(36) NOT NULL REFERENCES classes (id),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (class_id),
  CHECK (class_id != parent_id)
);

-- Triggers and additional polymorphic relationship validations removed for DuckDB (triggers are not supported)

-- Functions table for module-level functions
CREATE TABLE functions (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  return_type TEXT,
  is_async BOOLEAN NOT NULL DEFAULT FALSE,
  is_exported BOOLEAN NOT NULL DEFAULT FALSE,
  has_explicit_return_type BOOLEAN NOT NULL DEFAULT FALSE,
  start_line INTEGER,
  end_line INTEGER,
  logical_lines INTEGER,
  cyclomatic INTEGER,
  cognitive INTEGER,
  max_nesting INTEGER,
  parameter_count INTEGER,
  has_jsdoc BOOLEAN,
  return_type_is_any BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Symbol-level references to methods/properties discovered by parser analysis
CREATE TABLE symbol_references (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  source_symbol_id CHAR(36),
  source_symbol_type TEXT NOT NULL CHECK (source_symbol_type IN ('module', 'class', 'interface', 'function', 'method', 'property')),
  source_symbol_name TEXT,
  target_symbol_id CHAR(36) NOT NULL,
  target_symbol_type TEXT NOT NULL CHECK (target_symbol_type IN ('method', 'property')),
  target_symbol_name TEXT NOT NULL,
  access_kind TEXT NOT NULL CHECK (access_kind IN ('method', 'property')),
  qualifier_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Indexes for classes and interfaces (queried by module_id in ApiServerResponder)
CREATE INDEX idx_classes_module_id ON classes (module_id);
CREATE INDEX idx_interfaces_module_id ON interfaces (module_id);

-- Indexes for methods and properties (queried by parent_id in N+1 patterns)
CREATE INDEX idx_methods_parent ON methods (parent_id, parent_type);
CREATE INDEX idx_methods_module_id ON methods (module_id);
CREATE INDEX idx_properties_parent ON properties (parent_id, parent_type);
CREATE INDEX idx_properties_module_id ON properties (module_id);

-- Indexes for imports, exports, functions (queried by module_id)
CREATE INDEX idx_imports_module_id ON imports (module_id);
CREATE INDEX idx_exports_module_id ON exports (module_id);
CREATE INDEX idx_functions_module_id ON functions (module_id);

-- Indexes for parameters (queried by method_id)
CREATE INDEX idx_parameters_method_id ON parameters (method_id);

-- Indexes for junction tables (queried during relationship lookups)
CREATE INDEX idx_class_implements_class_id ON class_implements (class_id);
CREATE INDEX idx_class_implements_interface_id ON class_implements (interface_id);
CREATE INDEX idx_interface_extends_interface_id ON interface_extends (interface_id);
CREATE INDEX idx_class_extends_class_id ON class_extends (class_id);

-- Indexes for symbol references
CREATE INDEX idx_symbol_references_module_id ON symbol_references (module_id);
CREATE INDEX idx_symbol_references_target_symbol_id ON symbol_references (target_symbol_id);

-- Type aliases table for module-level type alias declarations
CREATE TABLE type_aliases (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  type_parameters_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Enums table for module-level enum declarations
CREATE TABLE enums (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  members_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Variables table for module-level const/let/var declarations
CREATE TABLE variables (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('const', 'let', 'var')),
  type TEXT,
  initializer TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Indexes for type aliases, enums, variables (queried by module_id)
CREATE INDEX idx_type_aliases_module_id ON type_aliases (module_id);
CREATE INDEX idx_enums_module_id ON enums (module_id);
CREATE INDEX idx_variables_module_id ON variables (module_id);

-- Code issues table for analysis rule findings
CREATE TABLE code_issues (
  id CHAR(36) PRIMARY KEY,
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  suggestion TEXT,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  file_path TEXT NOT NULL,
  entity_id CHAR(36),
  entity_type TEXT CHECK (entity_type IN ('class', 'interface', 'property', 'method', 'function', 'typeAlias', 'variable')),
  entity_name TEXT,
  parent_entity_id CHAR(36),
  parent_entity_type TEXT CHECK (parent_entity_type IN ('class', 'interface')),
  parent_entity_name TEXT,
  property_name TEXT,
  line INTEGER,
  "column" INTEGER,
  refactor_action TEXT,
  refactor_context_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX idx_code_issues_module_id ON code_issues (module_id);
CREATE INDEX idx_code_issues_package_id ON code_issues (package_id);
CREATE INDEX idx_code_issues_entity_id ON code_issues (entity_id);
CREATE INDEX idx_code_issues_rule_code ON code_issues (rule_code);

-- Analysis snapshots table (run-level metadata for baseline comparison)
CREATE TABLE analysis_snapshots (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  analyzer_versions_json TEXT,
  config_json TEXT,
  duration_ms INTEGER
);

CREATE INDEX idx_analysis_snapshots_package_id ON analysis_snapshots (package_id);

-- Entity metrics (wide-format, keyed by entity + metric name)
CREATE TABLE entity_metrics (
  id CHAR(36) PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL REFERENCES analysis_snapshots (id),
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36),
  entity_id CHAR(36) NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('package', 'module', 'class', 'interface', 'method', 'function', 'property', 'typeAlias', 'variable', 'enum')),
  metric_key TEXT NOT NULL,
  metric_value DOUBLE NOT NULL,
  metric_category TEXT NOT NULL CHECK (metric_category IN ('complexity', 'coupling', 'typeSafety', 'size', 'documentation', 'deadCode', 'duplication', 'testing', 'composite')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (snapshot_id, entity_id, entity_type, metric_key)
);

CREATE INDEX idx_entity_metrics_entity ON entity_metrics (entity_id, entity_type);
CREATE INDEX idx_entity_metrics_module_id ON entity_metrics (module_id);
CREATE INDEX idx_entity_metrics_key ON entity_metrics (metric_key);
CREATE INDEX idx_entity_metrics_snapshot ON entity_metrics (snapshot_id);

-- Call graph edges (function/method → function/method)
CREATE TABLE call_edges (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  source_entity_id CHAR(36) NOT NULL,
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('method', 'function')),
  target_entity_id CHAR(36),
  target_entity_type TEXT CHECK (target_entity_type IN ('method', 'function')),
  target_name TEXT,
  target_qualifier TEXT,
  call_expression_line INTEGER,
  is_async_call BOOLEAN NOT NULL DEFAULT FALSE,
  is_awaited BOOLEAN NOT NULL DEFAULT FALSE,
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('resolved', 'ambiguous', 'unresolved', 'external')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX idx_call_edges_source ON call_edges (source_entity_id);
CREATE INDEX idx_call_edges_target ON call_edges (target_entity_id);
CREATE INDEX idx_call_edges_module_id ON call_edges (module_id);

-- Dependency cycles (from dependency-cruiser / import graph)
CREATE TABLE dependency_cycles (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  length INTEGER NOT NULL,
  participants_json TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX idx_dependency_cycles_package ON dependency_cycles (package_id);

-- Copy-paste clusters (from jscpd)
CREATE TABLE duplication_clusters (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  token_count INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  fragment_count INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fragments_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX idx_duplication_clusters_package ON duplication_clusters (package_id);

-- Architectural rule violations (layered rules from dep-cruiser or custom)
CREATE TABLE architectural_violations (
  id CHAR(36) PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL REFERENCES analysis_snapshots (id),
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  rule_name TEXT NOT NULL,
  source_module_id CHAR(36),
  target_module_id CHAR(36),
  source_layer TEXT,
  target_layer TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX idx_arch_violations_package ON architectural_violations (package_id);
CREATE INDEX idx_arch_violations_snapshot ON architectural_violations (snapshot_id);
CREATE INDEX idx_arch_violations_source ON architectural_violations (source_module_id);
