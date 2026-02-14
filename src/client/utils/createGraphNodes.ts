import { Position } from '@vue-flow/core';

import { mapTypeCollection } from '../components/DependencyGraph/mapTypeCollection';
import { getNodeStyle } from '../theme/graphTheme';
import { isTestFilePath } from './testFileMatcher';

import type {
  DependencyKind,
  DependencyNode,
  DependencyPackageGraph,
  EmbeddedModuleEntity,
  EmbeddedSymbol,
  ExternalDependencyRef,
  ImportRef,
  ModuleStructure,
  NodeDiagnostics,
  NodeMethod,
  NodeProperty,
} from '../components/DependencyGraph/types';

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

function toNodeProperty(property: NodeProperty | Record<string, unknown>): NodeProperty {
  return {
    id: typeof property.id === 'string' ? property.id : undefined,
    name: toStringField(property.name, 'unknown'),
    type: toStringField(property.type, 'unknown'),
    visibility: toStringField(property.visibility, 'public'),
  };
}

function toNodeMethod(method: NodeMethod | Record<string, unknown>): NodeMethod {
  const methodName = toStringField(method.name, 'unknown');
  const returnType = toStringField(method.returnType, 'void');

  return {
    id: typeof method.id === 'string' ? method.id : undefined,
    name: methodName,
    returnType,
    visibility: toStringField(method.visibility, 'public'),
    signature:
      typeof method.signature === 'string' && method.signature.length > 0
        ? method.signature
        : `${methodName}(): ${returnType}`,
  };
}

/**
 * Creates graph nodes from the provided dependency package graph data.
 *
 * memberNodeMode controls how class/interface symbols are displayed:
 * - 'compact': Symbols are embedded as data within module nodes (no separate VueFlow nodes).
 * - 'graph': Symbols are created as separate VueFlow child nodes of modules.
 */
export function createGraphNodes(data: DependencyPackageGraph, options: CreateGraphNodeOptions = {}): DependencyNode[] {
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

  const getModuleImports = (module: ModuleStructure): string[] => {
    if (!module.imports || Object.keys(module.imports).length === 0) return [];
    return mapTypeCollection(module.imports, (imp: ImportRef) => imp.path ?? imp.name ?? '').filter(Boolean);
  };

  const getModuleExternalDependencies = (module: ModuleStructure): ExternalDependencyRef[] => {
    const explicitExternalDeps = (module as { externalDependencies?: unknown }).externalDependencies;
    if (Array.isArray(explicitExternalDeps)) {
      return explicitExternalDeps as ExternalDependencyRef[];
    }

    if (!module.imports || Object.keys(module.imports).length === 0) {
      return [];
    }

    const grouped = new Map<string, Set<string>>();

    mapTypeCollection(module.imports, (imp: ImportRef) => imp).forEach((imp) => {
      const importPath = imp.path ?? imp.name;
      if (!importPath) return;

      const inferredPackageName = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];
      const packageName = imp.packageName ?? inferredPackageName;
      const isExternal = imp.isExternal ?? (!importPath.startsWith('.') && !importPath.startsWith('/'));
      if (!isExternal || !packageName) {
        return;
      }

      const symbols = grouped.get(packageName) ?? new Set<string>();
      if (Array.isArray(imp.specifiers) && imp.specifiers.length > 0) {
        imp.specifiers.forEach((specifier) => {
          if (specifier.kind === 'sideEffect') {
            symbols.add('(side-effect)');
            return;
          }

          const symbol =
            specifier.local && specifier.local !== specifier.imported
              ? `${specifier.imported} as ${specifier.local}`
              : specifier.imported;
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

  const getModuleExports = (module: ModuleStructure): string[] => {
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

    return [];
  };

  // Collect embedded symbols for a module in compact mode.
  const collectEmbeddedSymbols = (module: ModuleStructure): EmbeddedSymbol[] => {
    const symbols: EmbeddedSymbol[] = [];

    if (includeClassNodes && module.classes) {
      mapTypeCollection(module.classes, (cls) => {
        const properties = cls.properties ? mapTypeCollection(cls.properties, (prop) => toNodeProperty(prop)) : [];
        const methods = cls.methods ? mapTypeCollection(cls.methods, (method) => toNodeMethod(method)) : [];
        symbols.push({ id: cls.id, type: 'class', name: cls.name, properties, methods });
      });
    }

    if (includeInterfaceNodes && module.interfaces) {
      mapTypeCollection(module.interfaces, (iface) => {
        const properties = iface.properties ? mapTypeCollection(iface.properties, (prop) => toNodeProperty(prop)) : [];
        const methods = iface.methods ? mapTypeCollection(iface.methods, (method) => toNodeMethod(method)) : [];
        symbols.push({ id: iface.id, type: 'interface', name: iface.name, properties, methods });
      });
    }

    return symbols;
  };

  // Collect module-level entities (functions, types, enums, consts, vars) for display.
  const collectModuleEntities = (module: ModuleStructure): EmbeddedModuleEntity[] => {
    const entities: EmbeddedModuleEntity[] = [];

    if (module.functions) {
      mapTypeCollection(module.functions, (fn) => {
        entities.push({
          id: fn.id,
          type: 'function',
          name: fn.name,
          detail: `(): ${fn.returnType}`,
          tags: fn.isAsync ? ['async'] : undefined,
        });
      });
    }

    if (module.typeAliases) {
      mapTypeCollection(module.typeAliases, (ta) => {
        const params = ta.typeParameters && ta.typeParameters.length > 0 ? `<${ta.typeParameters.join(', ')}>` : '';
        entities.push({
          id: ta.id,
          type: 'type',
          name: `${ta.name}${params}`,
          detail: ta.type.length > 60 ? ta.type.slice(0, 60) + '...' : ta.type,
        });
      });
    }

    if (module.enums) {
      mapTypeCollection(module.enums, (en) => {
        entities.push({
          id: en.id,
          type: 'enum',
          name: en.name,
          detail: `${en.members.length.toString()} members`,
        });
      });
    }

    if (module.variables) {
      mapTypeCollection(module.variables, (v) => {
        entities.push({
          id: v.id,
          type: v.kind === 'const' ? 'const' : 'var',
          name: v.name,
          detail: v.type,
        });
      });
    }

    return entities;
  };

  // Optionally create package nodes.
  if (includePackages) {
    data.packages.forEach((pkg) => {
      const totalModuleCount = pkg.modules ? Object.keys(pkg.modules).length : 0;
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
          properties: [{ name: 'version', type: pkg.version, visibility: 'public' }],
        },
        style: {
          ...getNodeStyle('package'),
          zIndex: 0,
        },
      });
    });
  }

  // Create module and symbol nodes.
  data.packages.forEach((pkg) => {
    if (!pkg.modules) return;

    mapTypeCollection(pkg.modules, (module) => {
      const classCountTotal = module.classes ? Object.keys(module.classes).length : 0;
      const interfaceCountTotal = module.interfaces ? Object.keys(module.interfaces).length : 0;
      const visibleClassCount = includeClassNodes ? classCountTotal : 0;
      const visibleInterfaceCount = includeInterfaceNodes ? interfaceCountTotal : 0;
      const totalSubnodeCount = classCountTotal + interfaceCountTotal;
      const modulePath = module.source.relativePath || '';
      const isModuleTestFile = isTestFilePath(modulePath);

      // In compact mode, symbols are embedded in the module node as data.
      // In graph mode, symbols become separate child VueFlow nodes.
      const hasVueFlowChildren = !isCompactMode && visibleClassCount + visibleInterfaceCount > 0;
      const visibleSubnodeCount = hasVueFlowChildren ? visibleClassCount + visibleInterfaceCount : 0;
      const hiddenSubnodeCount = hasVueFlowChildren ? Math.max(0, totalSubnodeCount - visibleSubnodeCount) : 0;

      if (includeModules) {
        const externalDependencies = getModuleExternalDependencies(module);
        const externalDependencyPackageCount = externalDependencies.length;
        const externalDependencySymbolCount = externalDependencies.reduce(
          (sum, dependency) => sum + dependency.symbols.length,
          0
        );
        const estimatedHeight = hasVueFlowChildren
          ? Math.max(140, 120 + Math.min(visibleSubnodeCount, 8) * 90)
          : undefined;

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
              { name: 'package', type: pkg.name, visibility: 'public' },
              { name: 'path', type: modulePath, visibility: 'public' },
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
        mapTypeCollection(module.classes, (cls) => {
          const properties = cls.properties ? mapTypeCollection(cls.properties, (prop) => toNodeProperty(prop)) : [];
          const methods = cls.methods ? mapTypeCollection(cls.methods, (method) => toNodeMethod(method)) : [];
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
        mapTypeCollection(module.interfaces, (iface) => {
          const properties = iface.properties
            ? mapTypeCollection(iface.properties, (prop) => toNodeProperty(prop))
            : [];
          const methods = iface.methods ? mapTypeCollection(iface.methods, (method) => toNodeMethod(method)) : [];
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
