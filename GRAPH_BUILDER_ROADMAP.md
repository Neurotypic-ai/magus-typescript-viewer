# Graph Builder Roadmap

This document outlines conventional and novel upgrade paths for the TypeScript analyzer and graph builder.
Each recommendation includes a maturity/stability note.

## 1) Module Resolution (Conventional, Stable)

**Recommendation:** Use the TypeScript Compiler API to resolve module specifiers using `tsconfig.json` (`baseUrl`, `paths`).

- **Stability:** **Stable** — maintained by the TypeScript team; API changes are versioned and documented.
- **Why:** Accurate resolution for path aliases, `index.ts` behavior, and extensionless imports.
- **Phases:**
  1. Parse `tsconfig.json` via the compiler API and expose a `ModuleResolver` service.
  2. Cache resolved module paths to avoid repeated work.
  3. Add diagnostics for unresolved imports and surface them in the UI.

**Novel alternative (Experimental):** Use `esbuild`/`rspack` resolver or `tsconfig-paths` as a fast pre-pass.
This can be faster but less complete than full compiler resolution.

## 2) Runtime Validation (Conventional, Mature)

**Recommendation:** Add Zod schemas for API payloads and graph objects.

- **Stability:** **Mature** — Zod has a stable API, strong ecosystem support, and is widely used.
- **Why:** Detects data drift between server and client; prevents undefined behavior in layout.
- **Phases:**
  1. Define schemas for `Package`, `Module`, `Class`, `Interface`, `ImportRef`, and graph edges.
  2. Validate API responses in `GraphDataAssembler` and clear cache on failures.
  3. Add error reporting for validation failures.

**Novel alternative (Experimental):** Use JSON Schema + Ajv with generated TS types. This is more formal but adds tooling complexity.

## 3) Type-Aware Refactoring (Conventional, Mature)

**Recommendation:** Integrate the TypeScript Language Service for type-aware refactors.

- **Stability:** **Mature** — Language Service APIs are well-established.
- **Why:** Enables safe renames, symbol moves, and signature changes without breaking the project.
- **Phases:**
  1. Stand up a Language Service host with project file caching.
  2. Implement rename + reference update flows.
  3. Add higher-level refactors (extract, move, inline).

**Novel alternative (Experimental):** Use `ts-morph` (wrapper on Language Service) for faster iteration.
This is developer-friendly but adds an abstraction layer.

## 4) Performance & Scale (Conventional, Stable)

**Recommendation:** Add incremental parsing and caching keyed by file hash.

- **Stability:** **Stable** — standard engineering practice with low risk.
- **Why:** Avoids re-parsing unchanged files; improves large project performance.

## Success Metrics

- 100% module resolution for `baseUrl`/`paths` projects.
- Zero invalid edges passed into layout.
- Fully type-safe refactors for rename and move.
