# Project Dependency Graph Visualization Tool

## Overview

This is a TypeScript-based tool that parses a codebase (focused on TypeScript/JavaScript) to build and visualize a
dependency graph. It tracks dependencies, symbols, and structural changes over time using a UUID-based linking system.
The tool uses DuckDB for persistent storage, and React Flow for interactive visualizations. **The layout of the graph is
powered by ELKJS to provide a clear, hierarchical view of package, module, and code entity relationships.** Additional
features include automated AST transformations with jscodeshift, a command-line interface built with commander, and
styling provided by Tailwind CSS and Material-UI.

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
