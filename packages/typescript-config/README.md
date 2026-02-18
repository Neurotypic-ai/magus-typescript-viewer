# @neurotypic-ai/typescript-config

Shared TypeScript configurations for Magus Mark projects.

## Usage

Add as a workspace dependency:

```json
"dependencies": {
  "@neurotypic-ai/typescript-config": "workspace:*"
}
```

Then extend the appropriate configuration in your project's `tsconfig.json`:

```json
{
  "extends": "@neurotypic-ai/typescript-config/library.json",
  // Additional project-specific settings
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

## Available Configurations

- **tsconfig.base.json**: Base configuration with common settings
- **tsconfig.settings.json**: Core TypeScript settings with strict type checking
- **tsconfig.build.json**: Settings for building production code
- **tsconfig.test.json**: Settings for test files
- **tsconfig.app.json**: Base settings for applications
- **library.json**: Settings for library packages (e.g., core)
- **cli.json**: Settings for CLI applications
- **obsidian.json**: Settings for Obsidian plugins
- **vscode.json**: Settings for VS Code extensions

## Notes

- These presets enable strict mode, declaration maps, and incremental builds
- Use project references for monorepos; presets are configured with `${configDir}` placeholders

## Project-Specific Configuration Examples

### Core Library

```json
{
  "extends": "@neurotypic-ai/typescript-config/library.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "declarationDir": "./dist/types"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### CLI Application

```json
{
  "extends": "@neurotypic-ai/typescript-config/cli.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Obsidian Plugin

```json
{
  "extends": "@neurotypic-ai/typescript-config/obsidian.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### VS Code Extension

```json
{
  "extends": "@neurotypic-ai/typescript-config/vscode.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```
