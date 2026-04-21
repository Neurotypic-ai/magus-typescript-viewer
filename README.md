# Project Dependency Graph Visualization Tool

## Overview

This is a TypeScript-based tool that parses a codebase (focused on TypeScript/JavaScript) to build and visualize a
dependency graph. It tracks dependencies, symbols, and structural changes over time using a UUID-based linking system.
The tool uses DuckDB for persistent storage, and React Flow for interactive visualizations. **The layout of the graph is
powered by ELKJS to provide a clear, hierarchical view of package, module, and code entity relationships.** Additional
features include automated AST transformations with jscodeshift, a command-line interface built with commander, and
styling provided by Tailwind CSS and Material-UI.

## Advanced Static Analysis

The analyzer runs 10 pluggable passes producing complexity, coupling, type-safety, dead-code,
duplication, architectural, documentation, and call-graph metrics. Results persist into the
DuckDB snapshot alongside the parsed graph so the UI can render them as heatmaps, panels, and
historical trend charts.

### Running the analyzer

```bash
# Fast tier (size + knip + eslint + dep-cruiser + duplication + rules + legacy passes)
pnpm analyze .

# Full ts-morph-powered analysis (adds complexity, type-safety, call-graph, coupling,
# documentation, and maintainability-index analyzers)
pnpm analyze --deep .
```

### Flags reference

| Flag | Purpose |
| --- | --- |
| `--deep` | Enable analyzers that require a shared ts-morph `Project`. |
| `--analyzers <csv>` | Allowlist by analyzer id (e.g. `--analyzers size,knip`). |
| `--no-size` / `--no-knip` / `--no-eslint` / `--no-dep-cruiser` / `--no-duplication` | Disable a specific analyzer. |
| `--config <path>` | Explicit path to a `typescript-viewer.analysis.json` file. |
| `--baseline <id\|latest>` | Compare metric deltas against a prior snapshot. |
| `--max-workers <n>` | Bound on concurrent per-file work (defaults to `cpu-count - 1`). |

### Config file

Drop a `typescript-viewer.analysis.json` at the project root to override thresholds,
architecture rules, analyzer allowlists, and ESLint extras. A template ships at
[`typescript-viewer.analysis.example.json`](./typescript-viewer.analysis.example.json) - copy
it and tweak.

### Tuning

- **Per-analyzer policy stubs** live at [`src/server/analysis/policies/`](./src/server/analysis/policies/).
  They hold the risk-appetite knobs (complexity classification, maintainability-index
  formula) that are most productively customized per codebase.
- **Built-in ESLint rules** for the analyzer run are assembled in
  [`src/server/analysis/eslint/analysis.config.ts`](./src/server/analysis/eslint/analysis.config.ts).
  Extend them from the `eslint.extraRules` block in the config file.

### Dashboard

Run `pnpm dev` to boot the visualization server. The **Metrics** panel in the graph UI exposes
seven tabs that read directly from the persisted snapshot:

- **Summary** - health score, counts of critical/warning/info insights.
- **Complexity** - cyclomatic/cognitive heatmaps + top offenders.
- **Type Safety** - `any` density, unchecked casts, implicit-any drift.
- **Dead Code** - knip + unreferenced exports.
- **Duplication** - jscpd clusters with jump-to-source.
- **Architecture** - layered-architecture forbidden-rule violations.
- **Trends** - baseline delta tables for each metric family.

### Graph overlays

The main graph view accepts analyzer-driven overlays: **Complexity**, **Coupling**, and
**TypeSafety** heatmaps tint nodes; **Cycle** highlights decorate edges inside a detected
dependency cycle; the **Dead-code** overlay dims unreferenced modules so you can spot them at
a glance.

## Installation

### Prerequisites

- Node.js (>=14.x)
- pnpm (recommended for monorepo management)

### Steps

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/your-repo.git
   cd your-repo
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build the project:

   ```bash
   pnpm run build
   ```

## Configuration

- **TypeScript:** Configured with strict settings. Refer to `tsconfig.json` for details.
- **Vite:** Used for a lightning-fast development server with native ESM support. Configuration is in `vite.config.ts`.
- **Tailwind CSS:** Used for main app styling. Customize settings in `tailwind.config.js`.
- **DuckDB:** Integrated via Node.js API for data persistence. Schema definitions and CRUD operations are in
  `src/db/duckdb.ts`.
- **Memgraph:** Used for graph operations via CSV export and LOAD CSV. Configuration is in `src/db/memgraph.ts`.

## Usage Examples

### Analyzing a TypeScript Project

To analyze a project:

```bash
pnpm run analyze -- --project /path/to/your/project
```

### Generating Visualization

To generate a dependency graph visualization:

```bash
pnpm run visualize -- --project /path/to/your/project
```

### Starting the Visualization Server

Launch the server to view the interactive graph:

```bash
pnpm run start
```

Then, open your browser and navigate to: [http://localhost:3000](http://localhost:3000)

## Common Workflows

1. **Development & Testing:**

   - Use Vite for hot module replacement during development.
   - Run unit and integration tests with Jest:

     ```bash
     pnpm run test
     ```

2. **Refactoring:**

   - Utilize jscodeshift for codemods to ensure consistent import/export patterns.

3. **Database Management:**

   - DuckDB stores the dependency graph persistently with native UUID support.
   - Export data to CSV if you need to migrate to Memgraph for in-memory graph processing.

4. **CLI Operations:**
   - Access various commands (analyze, visualize, export) via the CLI powered by commander, as defined in
     `src/cli/index.ts`.

## Additional Information

- For more details on the implementation, refer to the API documentation in `context/types.md` and the system overview
  in `context/overview.md`.
- The project follows a monorepo structure managed by pnpm, and further documentation is available in the individual
  files.

---

_This project is maintained with a focus on precision, efficiency, and modularity. For further customization and
troubleshooting, please consult the respective documentation links provided in the project plan._
