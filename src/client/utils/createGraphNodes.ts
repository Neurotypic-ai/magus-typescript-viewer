import { Position } from '@vue-flow/core';

import { Property } from '../../shared/types/Property';
import { getNodeStyle } from '../theme/graphTheme';
import { collectionSize, isNonEmptyCollection, mapTypeCollection } from './collections';
import { isTestFilePath } from './testFileMatcher';

import type { Class } from '../../shared/types/Class';
import type { Enum } from '../../shared/types/Enum';
import type { ModuleFunction } from '../../shared/types/Function';
import type { IImportSpecifier, Import } from '../../shared/types/Import';
import type { Interface } from '../../shared/types/Interface';
import type { Method } from '../../shared/types/Method';
import type { Module } from '../../shared/types/Module';
import type { Package, PackageGraph } from '../../shared/types/Package';
import type { TypeAlias } from '../../shared/types/TypeAlias';
import type { Variable } from '../../shared/types/Variable';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';
import type { EmbeddedModuleEntity } from '../../shared/types/graph/EmbeddedModuleEntity';
import type { EmbeddedSymbol } from '../../shared/types/graph/EmbeddedSymbol';
import type { ExternalDependencyRef } from '../../shared/types/graph/ExternalDependencyRef';
import type { NodeDiagnostics } from '../../shared/types/graph/NodeDiagnostics';
import type { DependencyNode } from '../types/DependencyNode';

interface CreateGraphNodeOptions {
  includePackages?: boolean;
  includeModules?: boolean;
  includeClasses?: boolean;
  includeClassNodes?: boolean;
  includeInterfaceNodes?: boolean;
  nestSymbolsInModules?: boolean;
  memberNodeMode?: 'compact' | 'graph';
  direction?: 'LR' | 'RL' | 'TB' | 'BT';
}

type ImportSpecifierLike = {
  imported: string;
  local?: string | undefined;
  kind: string;
};

function getExternalDependencyLevel(
  externalDependencyPackageCount: number,
  externalDependencySymbolCount: number
): 'normal' | 'high' | 'critical' {
  if (externalDependencyPackageCount >= 20 || externalDependencySymbolCount >= 120) {
    return 'critical';
  }

  if (externalDependencyPackageCount >= 12 || externalDependencySymbolCount >= 60) {
    return 'high';
  }

  return 'normal';
}

function createDiagnostics(params: {
  isTestFile: boolean;
  externalDependencyPackageCount?: number;
  externalDependencySymbolCount?: number;
}): NodeDiagnostics {
  const externalDependencyPackageCount = params.externalDependencyPackageCount ?? 0;
  const externalDependencySymbolCount = params.externalDependencySymbolCount ?? 0;

  return {
    isTestFile: params.isTestFile,
    orphanCurrent: false,
    orphanGlobal: false,
    externalDependencyPackageCount,
    externalDependencySymbolCount,
    externalDependencyLevel: getExternalDependencyLevel(externalDependencyPackageCount, externalDependencySymbolCount),
  };
}

function toStringField(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Avoid `(): : void` when the parser already includes a leading `: ` on return/type strings. */
function stripLeadingColonType(value: string): string {
  return value.replace(/^:\s*/, '').trim();
}

function firstImportAlias(specifier: IImportSpecifier): string | undefined {
  return Array.from(specifier.aliases)[0];
}

function getImportPath(importValue: Import & { path?: string }): string | undefined {
  return importValue.relativePath || importValue.fullPath || importValue.path || importValue.name;
}

function toImportSpecifierLike(
  specifier:
    | IImportSpecifier
    | {
        imported?: string;
        local?: string;
        kind?: string;
      }
): ImportSpecifierLike | undefined {
  if ('name' in specifier) {
    return {
      imported: specifier.name,
      ...(firstImportAlias(specifier) ? { local: firstImportAlias(specifier) } : {}),
      kind: specifier.kind,
    };
  }
  if (typeof specifier.imported !== 'string' || specifier.imported.length === 0) {
    return undefined;
  }
  return {
    imported: specifier.imported,
    ...(typeof specifier.local === 'string' && specifier.local.length > 0 ? { local: specifier.local } : {}),
    kind: typeof specifier.kind === 'string' ? specifier.kind : 'value',
  };
}

function getImportSpecifierLikes(
  importValue: Import & {
    specifiers?: Array<{ imported?: string; local?: string; kind?: string }> | Map<string, IImportSpecifier>;
  }
): ImportSpecifierLike[] {
  if (importValue.specifiers instanceof Map) {
    return Array.from(importValue.specifiers.values())
      .map((specifier) => toImportSpecifierLike(specifier))
      .filter((specifier): specifier is ImportSpecifierLike => Boolean(specifier));
  }
  const rawSpecifiers = importValue.specifiers as unknown;
  if (Array.isArray(rawSpecifiers)) {
    return (rawSpecifiers as Array<{ imported?: string; local?: string; kind?: string }>)
      .map((specifier) => toImportSpecifierLike(specifier))
      .filter((specifier): specifier is ImportSpecifierLike => Boolean(specifier));
  }
  return [];
}

function normalizeProperty(property: Property | Record<string, unknown>): Property {
  return property as Property;
}

function normalizeMethod(method: Method | Record<string, unknown>): Method {
  return method as Method;
}

/**
 * Creates graph nodes from the provided dependency package graph data.
 *
 * memberNodeMode controls how class/interface symbols are displayed:
 * - 'compact': Symbols are embedded as data within module nodes (no separate VueFlow nodes).
 * - 'graph': Symbols are created as separate VueFlow child nodes of modules.
 */
export function createGraphNodes(data: PackageGraph, options: CreateGraphNodeOptions = {}): DependencyNode[] {
  const {
    includePackages = false,
    includeModules = true,
    includeClasses = false,
    includeClassNodes = includeClasses,
    includeInterfaceNodes = includeClasses,
    nestSymbolsInModules = true,
    memberNodeMode = 'compact',
    direction = 'LR',
  } = options;

  const isCompactMode = memberNodeMode === 'compact';

  // Calculate handle positions based on layout direction.
  let sourcePosition: Position;
  let targetPosition: Position;

  switch (direction) {
    case 'LR':
      sourcePosition = Position.Right;
      targetPosition = Position.Left;
      break;
    case 'RL':
      sourcePosition = Position.Left;
      targetPosition = Position.Right;
      break;
    case 'TB':
      sourcePosition = Position.Bottom;
      targetPosition = Position.Top;
      break;
    case 'BT':
      sourcePosition = Position.Top;
      targetPosition = Position.Bottom;
      break;
  }

  const graphNodes: DependencyNode[] = [];

  const getModuleImports = (module: Module): string[] => {
    if (!isNonEmptyCollection(module.imports)) return [];
    return mapTypeCollection(module.imports, (imp: Import & { path?: string }) => getImportPath(imp) ?? '').filter(
      Boolean
    );
  };

  const getModuleExternalDependencies = (module: Module): ExternalDependencyRef[] => {
    const explicitExternalDeps = (module as { externalDependencies?: unknown }).externalDependencies;
    if (Array.isArray(explicitExternalDeps)) {
      return explicitExternalDeps as ExternalDependencyRef[];
    }

    if (!isNonEmptyCollection(module.imports)) {
      return [];
    }

    const grouped = new Map<string, Set<string>>();

    mapTypeCollection(
      module.imports,
      (imp: Import & { path?: string; isExternal?: boolean; packageName?: string }) => imp
    ).forEach((imp: Import & { path?: string; isExternal?: boolean; packageName?: string }) => {
      const importPath: string | undefined = getImportPath(imp);
      if (!importPath) return;

      const pathSegments: string[] = importPath.split('/');
      const inferredPackageName: string = importPath.startsWith('@')
        ? pathSegments.slice(0, 2).join('/')
        : (pathSegments[0] ?? '');
      const packageName: string = imp.packageName ?? inferredPackageName;
      const isExternal = imp.isExternal ?? (!importPath.startsWith('.') && !importPath.startsWith('/'));
      if (!isExternal || !packageName) {
        return;
      }

      const symbols = grouped.get(packageName) ?? new Set<string>();
      const specifiers = getImportSpecifierLikes(imp);
      if (specifiers.length > 0) {
        specifiers.forEach((specifier) => {
          if (specifier.kind === 'sideEffect') {
            symbols.add('(side-effect)');
            return;
          }

          const local = specifier.local;
          const symbol: string =
            local && local !== specifier.imported ? `${specifier.imported} as ${local}` : specifier.imported;
          if (symbol.length > 0) {
            symbols.add(symbol);
          }
        });
      } else {
        symbols.add('(side-effect)');
      }

      grouped.set(packageName, symbols);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([packageName, symbols]) => ({
        packageName,
        symbols: Array.from(symbols).sort((a, b) => a.localeCompare(b)),
      }));
  };

  const getModuleExports = (module: Module): string[] => {
    const exportsValue = (module as { exports?: unknown }).exports;
    if (!exportsValue) return [];

    if (exportsValue instanceof Map) {
      return Array.from(exportsValue.values())
        .map((value) => {
          if (typeof value === 'string') return value;
          if (value && typeof value === 'object') {
            const entry = value as { name?: string; path?: string };
            return entry.name ?? entry.path ?? '';
          }
          return '';
        })
        .filter(Boolean);
    }

    if (Array.isArray(exportsValue)) {
      return exportsValue
        .map((value) => {
          if (typeof value === 'string') return value;
          if (value && typeof value === 'object') {
            const entry = value as { name?: string; path?: string };
            return entry.name ?? entry.path ?? '';
          }
          return '';
        })
        .filter(Boolean);
    }

    if (typeof exportsValue === 'object') {
      return Object.values(exportsValue as Record<string, unknown>)
        .map((value: unknown) => {
          if (typeof value === 'string') return value;
          if (value && typeof value === 'object') {
            const entry = value as { name?: string; path?: string };
            return entry.name ?? entry.path ?? '';
          }
          return '';
        })
        .filter(Boolean);
    }

    return [];
  };

  // Collect embedded symbols for a module in compact mode.
  const collectEmbeddedSymbols = (module: Module): EmbeddedSymbol[] => {
    const symbols: EmbeddedSymbol[] = [];

    if (includeClassNodes && module.classes) {
      mapTypeCollection(module.classes, (cls: Class) => {
        const properties = cls.properties
          ? mapTypeCollection(cls.properties, (prop: Property) => normalizeProperty(prop))
          : [];
        const methods = cls.methods ? mapTypeCollection(cls.methods, (method: Method) => normalizeMethod(method)) : [];
        symbols.push({ id: cls.id, type: 'class', name: cls.name, properties, methods });
      });
    }

    if (includeInterfaceNodes && module.interfaces) {
      mapTypeCollection(module.interfaces, (iface: Interface) => {
        const properties = iface.properties
          ? mapTypeCollection(iface.properties, (prop: Property) => normalizeProperty(prop))
          : [];
        const methods = iface.methods
          ? mapTypeCollection(iface.methods, (method: Method) => normalizeMethod(method))
          : [];
        symbols.push({ id: iface.id, type: 'interface', name: iface.name, properties, methods });
      });
    }

    return symbols;
  };

  // Collect module-level entities (functions, types, enums, consts, vars) for display.
  const collectModuleEntities = (module: Module): EmbeddedModuleEntity[] => {
    const entities: EmbeddedModuleEntity[] = [];

    if (module.functions) {
      mapTypeCollection(module.functions, (fn: ModuleFunction) => {
        entities.push({
          id: fn.id,
          type: 'function',
          name: fn.name,
          detail: `(): ${stripLeadingColonType(toStringField(fn.return_type, 'void'))}`,
          tags: fn.is_async ? ['async'] : undefined,
        });
      });
    }

    if (module.typeAliases) {
      mapTypeCollection(module.typeAliases, (ta: TypeAlias) => {
        const typeParams = ta.type_parameters;
        const params = typeParams && typeParams.length > 0 ? `<${typeParams.join(', ')}>` : '';
        const typeStr = ta.type;
        entities.push({
          id: ta.id,
          type: 'type',
          name: `${ta.name}${params}`,
          detail: typeStr,
        });
      });
    }

    if (module.enums) {
      mapTypeCollection(module.enums, (en: Enum) => {
        const memberCount = en.members.length;
        entities.push({
          id: en.id,
          type: 'enum',
          name: en.name,
          detail: `${memberCount.toString()} members`,
        });
      });
    }

    if (module.variables) {
      mapTypeCollection(module.variables, (v: Variable) => {
        entities.push({
          id: v.id,
          type: v.kind === 'const' ? 'const' : 'var',
          name: v.name,
          detail: stripLeadingColonType(toStringField(v.type, 'unknown')),
        });
      });
    }

    return entities;
  };

  // Optionally create package nodes.
  if (includePackages) {
    data.packages.forEach((pkg: Package) => {
      const totalModuleCount = collectionSize(pkg.modules);
      const visibleModuleCount = includeModules ? totalModuleCount : 0;
      const hiddenModuleCount = Math.max(0, totalModuleCount - visibleModuleCount);

      graphNodes.push({
        id: pkg.id,
        type: 'package' as DependencyKind,
        position: { x: 0, y: 0 },
        sourcePosition,
        targetPosition,
        expandParent: true,
        data: {
          label: pkg.name,
          isContainer: true,
          layoutInsets: { top: 120 },
          diagnostics: createDiagnostics({ isTestFile: false }),
          subnodes: {
            count: visibleModuleCount,
            totalCount: totalModuleCount,
            visibleCount: visibleModuleCount,
            hiddenCount: hiddenModuleCount,
            byType: { module: visibleModuleCount },
            byTypeTotal: { module: totalModuleCount },
            byTypeVisible: { module: visibleModuleCount },
            isContainer: true,
          },
          properties: [
            new Property(
              `${pkg.id}:property:version`,
              pkg.id,
              '',
              pkg.id,
              'version',
              '',
              pkg.version,
              false,
              false,
              'public'
            ),
          ],
        },
        style: {
          ...getNodeStyle('package'),
          zIndex: 0,
        },
      });
    });
  }

  // Create module and symbol nodes.
  data.packages.forEach((pkg: Package) => {
    if (!pkg.modules) return;

    mapTypeCollection(pkg.modules, (module: Module) => {
      const classCountTotal = collectionSize(module.classes);
      const interfaceCountTotal = collectionSize(module.interfaces);
      const visibleClassCount = includeClassNodes ? classCountTotal : 0;
      const visibleInterfaceCount = includeInterfaceNodes ? interfaceCountTotal : 0;
      const totalSubnodeCount = classCountTotal + interfaceCountTotal;
      const modulePath: string = module.source.relativePath;
      const isModuleTestFile = isTestFilePath(modulePath);

      // In compact mode, symbols are embedded in the module node as data.
      // In graph mode, symbols become separate child VueFlow nodes.
      const hasVueFlowChildren = !isCompactMode && visibleClassCount + visibleInterfaceCount > 0;
      const visibleSubnodeCount = hasVueFlowChildren ? visibleClassCount + visibleInterfaceCount : 0;
      const hiddenSubnodeCount = hasVueFlowChildren ? Math.max(0, totalSubnodeCount - visibleSubnodeCount) : 0;

      if (includeModules) {
        const externalDependencies: ExternalDependencyRef[] = getModuleExternalDependencies(module);
        const externalDependencyPackageCount: number = externalDependencies.length;
        const externalDependencySymbolCount: number = externalDependencies.reduce(
          (sum: number, dependency: ExternalDependencyRef) => sum + dependency.symbols.length,
          0
        );
        const estimatedHeight = hasVueFlowChildren ? Math.max(140, 120 + visibleSubnodeCount * 90) : undefined;

        // In compact mode, embed class/interface data as symbols.
        const embeddedSymbols = isCompactMode ? collectEmbeddedSymbols(module) : undefined;
        const moduleEntities = collectModuleEntities(module);

        const moduleNode: DependencyNode = {
          id: module.id,
          type: 'module' as DependencyKind,
          position: { x: 0, y: 0 },
          sourcePosition,
          targetPosition,
          data: {
            label: module.name,
            imports: getModuleImports(module),
            exports: getModuleExports(module),
            externalDependencies,
            ...(embeddedSymbols && embeddedSymbols.length > 0 ? { symbols: embeddedSymbols } : {}),
            ...(moduleEntities.length > 0 ? { moduleEntities } : {}),
            isContainer: hasVueFlowChildren,
            ...(hasVueFlowChildren ? { layoutInsets: { top: 120 } } : {}),
            diagnostics: createDiagnostics({
              isTestFile: isModuleTestFile,
              externalDependencyPackageCount,
              externalDependencySymbolCount,
            }),
            subnodes: {
              count: visibleSubnodeCount,
              totalCount: totalSubnodeCount,
              visibleCount: visibleSubnodeCount,
              hiddenCount: hiddenSubnodeCount,
              byType: {
                class: hasVueFlowChildren ? visibleClassCount : 0,
                interface: hasVueFlowChildren ? visibleInterfaceCount : 0,
              },
              byTypeTotal: {
                class: classCountTotal,
                interface: interfaceCountTotal,
              },
              byTypeVisible: {
                class: hasVueFlowChildren ? visibleClassCount : 0,
                interface: hasVueFlowChildren ? visibleInterfaceCount : 0,
              },
              isContainer: hasVueFlowChildren,
            },
            properties: [
              new Property(
                `${module.id}:property:package`,
                pkg.id,
                module.id,
                module.id,
                'package',
                '',
                pkg.name,
                false,
                false,
                'public'
              ),
              new Property(
                `${module.id}:property:path`,
                pkg.id,
                module.id,
                module.id,
                'path',
                '',
                modulePath,
                false,
                false,
                'public'
              ),
            ],
          },
          style: {
            ...getNodeStyle('module'),
            ...(nestSymbolsInModules && hasVueFlowChildren && estimatedHeight
              ? {
                  minWidth: 340,
                  minHeight: estimatedHeight,
                }
              : {}),
            zIndex: 1,
          },
        };

        // Only add parent relationship if packages are included.
        if (includePackages) {
          moduleNode.parentNode = pkg.id;
          moduleNode.extent = 'parent' as const;
          moduleNode.expandParent = true;
          if (moduleNode.data) {
            moduleNode.data.parentId = pkg.id;
          }
        }

        graphNodes.push(moduleNode);
      }

      // In compact mode, symbols are embedded in module data — skip VueFlow nodes.
      if (isCompactMode) return;

      const parentForSymbols = includeModules && nestSymbolsInModules ? module.id : undefined;

      // Create class nodes as separate VueFlow nodes.
      if (includeClassNodes && module.classes) {
        mapTypeCollection(module.classes, (cls: Class) => {
          const properties = cls.properties
            ? mapTypeCollection(cls.properties, (prop: Property) => normalizeProperty(prop))
            : [];
          const methods = cls.methods
            ? mapTypeCollection(cls.methods, (method: Method) => normalizeMethod(method))
            : [];
          const memberTotal = properties.length + methods.length;

          const classNode: DependencyNode = {
            id: cls.id,
            type: 'class' as DependencyKind,
            position: { x: 0, y: 0 },
            sourcePosition,
            targetPosition,
            data: {
              ...(parentForSymbols ? { parentId: parentForSymbols } : {}),
              label: cls.name,
              properties,
              methods,
              members: {
                totalCount: memberTotal,
                byType: {
                  property: properties.length,
                  method: methods.length,
                },
              },
              collapsible: false,
              diagnostics: createDiagnostics({ isTestFile: isModuleTestFile }),
            },
            draggable: true,
            style: {
              ...getNodeStyle('class'),
              zIndex: 3,
            },
          };

          if (parentForSymbols) {
            classNode.parentNode = parentForSymbols;
            classNode.extent = 'parent' as const;
            classNode.expandParent = true;
          }

          graphNodes.push(classNode);
        });
      }

      // Create interface nodes as separate VueFlow nodes.
      if (includeInterfaceNodes && module.interfaces) {
        mapTypeCollection(module.interfaces, (iface: Interface) => {
          const properties = iface.properties
            ? mapTypeCollection(iface.properties, (prop: Property) => normalizeProperty(prop))
            : [];
          const methods = iface.methods
            ? mapTypeCollection(iface.methods, (method: Method) => normalizeMethod(method))
            : [];
          const memberTotal = properties.length + methods.length;

          const interfaceNode: DependencyNode = {
            id: iface.id,
            type: 'interface' as DependencyKind,
            position: { x: 0, y: 0 },
            sourcePosition,
            targetPosition,
            data: {
              ...(parentForSymbols ? { parentId: parentForSymbols } : {}),
              label: iface.name,
              properties,
              methods,
              members: {
                totalCount: memberTotal,
                byType: {
                  property: properties.length,
                  method: methods.length,
                },
              },
              collapsible: false,
              diagnostics: createDiagnostics({ isTestFile: isModuleTestFile }),
            },
            draggable: true,
            style: {
              ...getNodeStyle('interface'),
              zIndex: 3,
            },
          };

          if (parentForSymbols) {
            interfaceNode.parentNode = parentForSymbols;
            interfaceNode.extent = 'parent' as const;
            interfaceNode.expandParent = true;
          }

          graphNodes.push(interfaceNode);
        });
      }
    });
  });

  return graphNodes;
}
