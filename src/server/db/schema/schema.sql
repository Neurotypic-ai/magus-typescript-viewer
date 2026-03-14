-- Database Schema for TypeScript Codebase Analyzer using DuckDB native UUIDs
-- All tables use UUID for primary keys and proper foreign key references.
-- Timestamps are stored as TIMESTAMP and default to CURRENT_TIMESTAMP.
-- Note: DuckDB does not support ON DELETE CASCADE or triggers.

-- Packages table
CREATE TABLE packages (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  path TEXT NOT NULL,
  commit_hash CHAR(40),
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

-- Indexes for dependency lookups
CREATE INDEX idx_dependencies_source_id ON dependencies (source_id);
CREATE INDEX idx_dependencies_target_id ON dependencies (target_id);

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

-- Index for module_tests lookups
CREATE INDEX idx_module_tests_module_id ON module_tests (module_id);

-- Classes table with denormalized package_id and module_id
CREATE TABLE classes (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  extends_id CHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Interfaces table with denormalized package_id and module_id
CREATE TABLE interfaces (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  name TEXT NOT NULL,
  extends_id CHAR(36),
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

-- Call edges extracted from function/method bodies
CREATE TABLE call_edges (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  caller_id CHAR(36) NOT NULL,
  caller_name TEXT NOT NULL,
  callee_name TEXT NOT NULL,
  qualifier TEXT,
  call_type TEXT NOT NULL CHECK (call_type IN ('function', 'method', 'constructor', 'static')),
  line INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (caller_id, callee_name, qualifier, call_type)
);

-- User-defined type references extracted from type annotations
CREATE TABLE type_references (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  source_id CHAR(36) NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('property', 'method', 'parameter')),
  type_name TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('property_type', 'parameter_type', 'return_type', 'generic_argument')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (source_id, source_kind, type_name, context)
);

-- Technical debt markers detected in source files
CREATE TABLE tech_debt_markers (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL REFERENCES packages (id),
  module_id CHAR(36) NOT NULL REFERENCES modules (id),
  marker_type TEXT NOT NULL CHECK (marker_type IN ('any_type', 'ts_ignore', 'ts_expect_error', 'type_assertion', 'non_null_assertion', 'todo_comment', 'fixme_comment', 'hack_comment')),
  line INTEGER NOT NULL,
  snippet TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (module_id, marker_type, line, snippet)
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

-- Indexes for call edges, type references, and tech debt markers
CREATE INDEX idx_call_edges_module_id ON call_edges (module_id);
CREATE INDEX idx_call_edges_caller_id ON call_edges (caller_id);
CREATE INDEX idx_type_references_module_id ON type_references (module_id);
CREATE INDEX idx_type_references_source_id ON type_references (source_id);
CREATE INDEX idx_type_references_type_name ON type_references (type_name);
CREATE INDEX idx_tech_debt_markers_module_id ON tech_debt_markers (module_id);
CREATE INDEX idx_tech_debt_markers_marker_type ON tech_debt_markers (marker_type);

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

-- Snapshots table: one row per analyzed git commit
CREATE TABLE snapshots (
  id           CHAR(36)   NOT NULL PRIMARY KEY,
  repo_path    TEXT       NOT NULL,
  commit_hash  CHAR(40)   NOT NULL,
  commit_short CHAR(7)    NOT NULL,
  subject      TEXT       NOT NULL,
  author_name  TEXT       NOT NULL,
  author_email TEXT       NOT NULL,
  commit_at    TIMESTAMP  NOT NULL,
  package_id   CHAR(36)   NOT NULL REFERENCES packages (id),
  ordinal      INTEGER    NOT NULL,
  created_at   TIMESTAMP  NOT NULL DEFAULT current_timestamp,
  UNIQUE (repo_path, commit_hash)
);

CREATE INDEX idx_snapshots_repo_path ON snapshots (repo_path);
CREATE INDEX idx_snapshots_ordinal   ON snapshots (ordinal);
