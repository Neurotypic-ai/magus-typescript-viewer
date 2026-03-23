# Shared types layout

- **`*.ts` (root)** — Domain/raw reusable types and rich shared models (`Module`, `Package`, etc.).
- **`api/`** — Cross-runtime JSON/wire contracts only (serializable shapes; no `Map` assumptions for HTTP).
- **`dto/`** — Create/update/import DTOs shared by parsers, services, and repositories.
- **`graph/`** — Dependency graph view-model / API payload shapes (`DependencyPackageGraph`, `ModuleStructure`, etc.) shared by the client assembler and UI. Vue Flow–specific types (`DependencyNode`, `GraphEdge`, `DependencyProps`, `SearchResult`) stay in `src/client/types/`.

Migration order for moving types: **add file → update imports → delete old definition**.

No barrel (`index.ts`) exports; import from concrete paths.
