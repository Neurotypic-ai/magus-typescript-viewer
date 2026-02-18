# Library Package Agent

## Overview

Generic TypeScript package guidance for framework-agnostic libraries.

## Directory Structure

- `src/` - Source code
- `src/__tests__/` - Unit tests (co-located)
- `test/` - Test utilities and setup

## Module Patterns

- Export public API from entry point (`src/index.ts`)
- Use named exports, avoid default exports
- Separate internal types from public API
- Use JSDoc for public functions

## Testing Patterns

- Use Vitest for unit tests
- Co-locate tests with source (`*.test.ts`)
- Use `test/setup.ts` for global test configuration
- Mock external dependencies

## Build Configuration

- TypeScript strict mode enabled
- Composite builds for monorepo
- Isolated declarations

## Critical Rules

- No barrel files except entry point
- No dynamic imports
- Full type coverage required
- Use consola for logging:
  ```typescript
  import { consola } from 'consola';
  const logger = consola.withTag('module-name');
  ```

## Package Scope

All packages in this monorepo use the `@@neurotypic-ai/` scope prefix.

## Import Guidelines

- Import from package entry points, not internal paths
- Use workspace protocol for internal dependencies: `"@@neurotypic-ai/shared": "workspace:*"`
- Avoid circular dependencies between packages

## Type Safety

- Enable strict TypeScript configuration
- Prefer explicit return types on public functions
- Use `unknown` over `any` where type is uncertain
- Leverage type inference for internal implementation

## Documentation Standards

- JSDoc comments on all public exports
- Include `@param`, `@returns`, and `@example` tags
- Document thrown errors with `@throws`
- Keep examples runnable and tested
