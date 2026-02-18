# Shared Package Agent

## Overview

Guidance for shared utility packages containing helpers, types, and Vite plugins.

## Directory Structure

- `src/helpers/` - Utility functions
- `src/types/` - Shared TypeScript types
- `src/vite/` - Vite plugins

## Utility Patterns

- Pure functions (no side effects)
- Generic type constraints for flexibility
- Comprehensive JSDoc documentation
- Input validation at boundaries

## Vite Plugin Patterns

- Factory function returning Plugin object
- Typed configuration options
- Development vs production behavior
- Example:
  ```typescript
  export function myPlugin(options: MyPluginOptions): Plugin {
    return {
      name: 'my-plugin',
      // ...
    };
  }
  ```

## Export Strategy

- Entry point re-exports public API
- Subpath exports for tree-shaking:
  ```json
  "exports": {
    ".": "./src/index.ts",
    "./helpers/*": "./src/helpers/*.ts",
    "./types": "./src/types/index.ts"
  }
  ```

## Critical Rules

- Framework-agnostic (works in Vue AND React)
- No framework-specific dependencies
- Full type coverage
- Comprehensive unit tests

## Package Scope

All packages in this monorepo use the `@@neurotypic-ai/` scope prefix.

## Helper Function Guidelines

- Keep functions small and focused on a single task
- Prefer composition over complex multi-purpose functions
- Use descriptive names that indicate what the function does
- Return new values rather than mutating inputs

## Type Definition Guidelines

- Export interfaces for object shapes that may be extended
- Export type aliases for unions, intersections, and utility types
- Use branded types for domain-specific primitives when needed
- Keep types co-located with their primary consumers when possible

## Testing Requirements

- Unit test all helper functions
- Test edge cases and error conditions
- Verify type exports compile correctly
- Test Vite plugins in isolation with mock contexts

## Cross-Framework Compatibility

- Do not import from `vue`, `react`, or other framework packages
- Use standard Web APIs and TypeScript utilities
- Test in both Vue and React consuming applications
- Document any browser compatibility requirements
