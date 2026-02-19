import type { ASTPath, ExportNamedDeclaration, ImportDeclaration } from 'jscodeshift';

import { Import, ImportSpecifier } from '../../../shared/types/Import';
import { generateImportUUID } from '../../utils/uuid';
import { getIdentifierName } from './astUtils';
import type { ModuleParserContext } from './types';

export interface ImportsExportsResult {
  imports: Map<string, Import>;
  exports: Set<string>;
  reExports: Set<string>;
}

/**
 * Parse all import declarations, export declarations, and re-exports from
 * the module AST.  Returns Maps/Sets rather than mutating class state so
 * the caller can decide how to integrate the results.
 */
export function parseImportsAndExports(ctx: ModuleParserContext): ImportsExportsResult {
  const imports = new Map<string, Import>();
  const exports = new Set<string>();
  const reExports = new Set<string>();

  // Parse imports first
  ctx.root.find(ctx.j.ImportDeclaration).forEach((path: ASTPath<ImportDeclaration>) => {
    const importPath = path.node.source.value;
    if (typeof importPath !== 'string') return;

    const importSpecifiers = new Map<string, ImportSpecifier>();
    const isTypeImport = path.node.importKind === 'type';

    path.node.specifiers?.forEach((specifier) => {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        const importedName = specifier.imported.name;
        const localName = specifier.local?.type === 'Identifier' ? specifier.local.name : importedName;
        const uuid = generateImportUUID(importPath, importedName);
        const kind = isTypeImport ? 'type' : 'value';
        const aliases = new Set<string>();
        if (localName !== importedName) {
          aliases.add(localName);
        }
        const importSpecifier = new ImportSpecifier(
          uuid,
          importedName,
          kind,
          undefined,
          new Set(),
          aliases
        );
        importSpecifiers.set(localName, importSpecifier);
      } else if (specifier.type === 'ImportDefaultSpecifier' && specifier.local?.type === 'Identifier') {
        const name = specifier.local.name;
        const uuid = generateImportUUID(importPath, name);
        const kind = isTypeImport ? 'type' : 'default';
        const importSpecifier = new ImportSpecifier(uuid, name, kind, undefined, new Set(), new Set());
        importSpecifiers.set(name, importSpecifier);
      } else if (specifier.type === 'ImportNamespaceSpecifier' && specifier.local?.type === 'Identifier') {
        const name = specifier.local.name;
        const uuid = generateImportUUID(importPath, name);
        const kind = isTypeImport ? 'type' : 'namespace';
        const importSpecifier = new ImportSpecifier(uuid, name, kind, undefined, new Set(), new Set());
        importSpecifiers.set(name, importSpecifier);
      }
    });

    const existingImport = imports.get(importPath);
    if (existingImport) {
      importSpecifiers.forEach((spec, name) => {
        if (!existingImport.specifiers.has(name)) {
          existingImport.specifiers.set(name, spec);
        }
      });
      return;
    }

    // Create the Import instance with module-specific UUID (even for side-effect imports)
    const uuid = generateImportUUID(ctx.moduleId, importPath);
    const imp = new Import(uuid, importPath, importPath, importPath, importSpecifiers);
    imports.set(importPath, imp);
  });

  // Parse exports and track re-exports
  ctx.root.find(ctx.j.ExportNamedDeclaration).forEach((path: ASTPath<ExportNamedDeclaration>) => {
    // Handle re-exports (export { x } from 'module')
    if (path.node.source) {
      path.node.specifiers?.forEach((specifier) => {
        if (specifier.exported.type === 'Identifier') {
          reExports.add(specifier.exported.name);
          exports.add(specifier.exported.name);
        }
      });
    }
    // Handle local exports
    else if (path.node.declaration) {
      if (path.node.declaration.type === 'ClassDeclaration' && path.node.declaration.id) {
        const name = getIdentifierName(path.node.declaration.id);
        if (name) exports.add(name);
      } else if (path.node.declaration.type === 'VariableDeclaration') {
        path.node.declaration.declarations.forEach((decl) => {
          if ('id' in decl && decl.id.type === 'Identifier') {
            const name = getIdentifierName(decl.id);
            if (name) exports.add(name);
          }
        });
      } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
        const name = getIdentifierName(path.node.declaration.id);
        if (name) exports.add(name);
      } else if (path.node.declaration.type === 'TSTypeAliasDeclaration') {
        const name = getIdentifierName(path.node.declaration.id);
        if (name) exports.add(name);
      } else if (path.node.declaration.type === 'TSEnumDeclaration') {
        const name = getIdentifierName(path.node.declaration.id);
        if (name) exports.add(name);
      }
    }
  });

  // Also handle export * from 'module'
  ctx.root.find(ctx.j.ExportAllDeclaration).forEach((path) => {
    if (typeof path.node.source.value === 'string') {
      // Mark this module as having re-exports
      reExports.add('*');
    }
  });

  return { imports, exports, reExports };
}

/**
 * Determine whether a module is a "barrel file" — one whose exports are
 * predominantly re-exports from other modules.
 *
 * A module is considered a barrel if:
 * - It has a wildcard re-export (`export * from '...'`), OR
 * - More than 80% of its exports are re-exports.
 */
export function isBarrelFile(exports: Set<string>, reExports: Set<string>): boolean {
  if (exports.size === 0) return false;

  // If we have a wildcard export, consider it a barrel
  if (reExports.has('*')) return true;

  // Calculate the ratio of re-exports to total exports
  const reExportRatio = reExports.size / exports.size;

  // Consider it a barrel if more than 80% of exports are re-exports
  return reExportRatio > 0.8;
}
