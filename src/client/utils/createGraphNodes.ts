import { Position } from '@vue-flow/core';

import { mapTypeCollection } from '../components/DependencyGraph/mapTypeCollection';
import { getNodeStyle } from '../theme/graphTheme';
import { isTestFilePath } from './testFileMatcher';

import type {
  DependencyKind,
  DependencyNode,
  DependencyPackageGraph,
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

function toNodeProperty(property: NodeProperty | Record<string, unknown>): NodeProperty {
  return {
    id: typeof property.id === 'string' ? property.id : undefined,
    name: String(property.name ?? 'unknown'),
    type: String(property.type ?? 'unknown'),
    visibility: String(property.visibility ?? 'public'),
  };
}

function toNodeMethod(method: NodeMethod | Record<string, unknown>): NodeMethod {
  const methodName = String(method.name ?? 'unknown');
  const returnType = String(method.returnType ?? 'void');

  return {
    id: typeof method.id === 'string' ? method.id : undefined,
    name: methodName,
    returnType,
    visibility: String(method.visibility ?? 'public'),
    signature:
      typeof method.signature === 'string' && method.signature.length > 0
        ? method.signature
        : `${methodName}(): ${returnType}`,
  };
}

function createMemberNode(
  id: string,
  type: 'property' | 'method',
  label: string,
  sourcePosition: Position,
  targetPosition: Position,
  parentNodeId: string,
  isTestFile: boolean
): DependencyNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    sourcePosition,
    targetPosition,
    parentNode: parentNodeId,
    extent: 'parent' as const,
    expandParent: true,
    data: {
      label,
      parentId: parentNodeId,
      diagnostics: createDiagnostics({ isTestFile }),
    },
    style: {
      ...getNodeStyle(type),
      zIndex: 3,
    },
  };
}

/**
 * Creates graph nodes from the provided dependency package graph data.
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

  const includeMemberNodes = memberNodeMode === 'graph';

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

  // Create module, symbol, and optional member nodes.
  data.packages.forEach((pkg) => {
    if (!pkg.modules) return;

    mapTypeCollection(pkg.modules, (module) => {
      const classCountTotal = module.classes ? Object.keys(module.classes).length : 0;
      const interfaceCountTotal = module.interfaces ? Object.keys(module.interfaces).length : 0;
      const visibleClassCount = includeClassNodes ? classCountTotal : 0;
      const visibleInterfaceCount = includeInterfaceNodes ? interfaceCountTotal : 0;
      const totalSubnodeCount = classCountTotal + interfaceCountTotal;
      const visibleSubnodeCount = visibleClassCount + visibleInterfaceCount;
      const hiddenSubnodeCount = Math.max(0, totalSubnodeCount - visibleSubnodeCount);
      const modulePath = module.source.relativePath || '';
      const isModuleTestFile = isTestFilePath(modulePath);

      if (includeModules) {
        const externalDependencies = getModuleExternalDependencies(module);
        const externalDependencyPackageCount = externalDependencies.length;
        const externalDependencySymbolCount = externalDependencies.reduce(
          (sum, dependency) => sum + dependency.symbols.length,
          0
        );
        const estimatedHeight = Math.max(140, 120 + Math.min(visibleSubnodeCount, 8) * 90);

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
            isContainer: true,
            layoutInsets: { top: 120 },
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
                class: visibleClassCount,
                interface: visibleInterfaceCount,
              },
              byTypeTotal: {
                class: classCountTotal,
                interface: interfaceCountTotal,
              },
              byTypeVisible: {
                class: visibleClassCount,
                interface: visibleInterfaceCount,
              },
              isContainer: true,
            },
            properties: [
              { name: 'package', type: pkg.name, visibility: 'public' },
              { name: 'path', type: modulePath, visibility: 'public' },
            ],
          },
          style: {
            ...getNodeStyle('module'),
            maxWidth: 520,
            ...(nestSymbolsInModules && visibleSubnodeCount > 0
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

      const parentForSymbols = includeModules && nestSymbolsInModules ? module.id : undefined;

      // Optionally add class nodes.
      if (includeClassNodes && module.classes) {
        mapTypeCollection(module.classes, (cls) => {
          const properties = cls.properties ? mapTypeCollection(cls.properties, (prop) => toNodeProperty(prop)) : [];
          const methods = cls.methods ? mapTypeCollection(cls.methods, (method) => toNodeMethod(method)) : [];
          const memberTotal = properties.length + methods.length;
          const subnodeVisibleCount = includeMemberNodes ? memberTotal : 0;
          const subnodeHiddenCount = Math.max(0, memberTotal - subnodeVisibleCount);

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
                mode: memberNodeMode,
              },
              diagnostics: createDiagnostics({ isTestFile: isModuleTestFile }),
              layoutInsets: { top: 90 },
              isContainer: includeMemberNodes && memberTotal > 0,
              ...(includeMemberNodes
                ? {
                    subnodes: {
                      count: subnodeVisibleCount,
                      totalCount: memberTotal,
                      visibleCount: subnodeVisibleCount,
                      hiddenCount: subnodeHiddenCount,
                      byType: {
                        property: properties.length,
                        method: methods.length,
                      },
                      byTypeTotal: {
                        property: properties.length,
                        method: methods.length,
                      },
                      byTypeVisible: {
                        property: properties.length,
                        method: methods.length,
                      },
                      isContainer: true,
                    },
                  }
                : {}),
            },
            style: {
              ...getNodeStyle('class'),
              ...(memberTotal > 0 ? { minHeight: Math.max(120, 100 + Math.min(memberTotal, 10) * 16) } : {}),
              zIndex: 2,
            },
          };

          if (parentForSymbols) {
            classNode.parentNode = parentForSymbols;
            classNode.extent = 'parent' as const;
            classNode.expandParent = true;
          }

          graphNodes.push(classNode);

          if (includeMemberNodes && memberTotal > 0) {
            properties.forEach((property) => {
              const propertyId = property.id ?? `${cls.id}:property:${property.name}`;
              graphNodes.push(
                createMemberNode(
                  propertyId,
                  'property',
                  `${property.name}: ${property.type}`,
                  sourcePosition,
                  targetPosition,
                  cls.id,
                  isModuleTestFile
                )
              );
            });

            methods.forEach((method) => {
              const methodId = method.id ?? `${cls.id}:method:${method.name}`;
              graphNodes.push(
                createMemberNode(
                  methodId,
                  'method',
                  `${method.name}(): ${method.returnType}`,
                  sourcePosition,
                  targetPosition,
                  cls.id,
                  isModuleTestFile
                )
              );
            });
          }
        });
      }

      // Optionally add interface nodes.
      if (includeInterfaceNodes && module.interfaces) {
        mapTypeCollection(module.interfaces, (iface) => {
          const properties = iface.properties ? mapTypeCollection(iface.properties, (prop) => toNodeProperty(prop)) : [];
          const methods = iface.methods ? mapTypeCollection(iface.methods, (method) => toNodeMethod(method)) : [];
          const memberTotal = properties.length + methods.length;
          const subnodeVisibleCount = includeMemberNodes ? memberTotal : 0;
          const subnodeHiddenCount = Math.max(0, memberTotal - subnodeVisibleCount);

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
                mode: memberNodeMode,
              },
              diagnostics: createDiagnostics({ isTestFile: isModuleTestFile }),
              layoutInsets: { top: 90 },
              isContainer: includeMemberNodes && memberTotal > 0,
              ...(includeMemberNodes
                ? {
                    subnodes: {
                      count: subnodeVisibleCount,
                      totalCount: memberTotal,
                      visibleCount: subnodeVisibleCount,
                      hiddenCount: subnodeHiddenCount,
                      byType: {
                        property: properties.length,
                        method: methods.length,
                      },
                      byTypeTotal: {
                        property: properties.length,
                        method: methods.length,
                      },
                      byTypeVisible: {
                        property: properties.length,
                        method: methods.length,
                      },
                      isContainer: true,
                    },
                  }
                : {}),
            },
            style: {
              ...getNodeStyle('interface'),
              ...(memberTotal > 0 ? { minHeight: Math.max(120, 100 + Math.min(memberTotal, 10) * 16) } : {}),
              zIndex: 2,
            },
          };

          if (parentForSymbols) {
            interfaceNode.parentNode = parentForSymbols;
            interfaceNode.extent = 'parent' as const;
            interfaceNode.expandParent = true;
          }

          graphNodes.push(interfaceNode);

          if (includeMemberNodes && memberTotal > 0) {
            properties.forEach((property) => {
              const propertyId = property.id ?? `${iface.id}:property:${property.name}`;
              graphNodes.push(
                createMemberNode(
                  propertyId,
                  'property',
                  `${property.name}: ${property.type}`,
                  sourcePosition,
                  targetPosition,
                  iface.id,
                  isModuleTestFile
                )
              );
            });

            methods.forEach((method) => {
              const methodId = method.id ?? `${iface.id}:method:${method.name}`;
              graphNodes.push(
                createMemberNode(
                  methodId,
                  'method',
                  `${method.name}(): ${method.returnType}`,
                  sourcePosition,
                  targetPosition,
                  iface.id,
                  isModuleTestFile
                )
              );
            });
          }
        });
      }
    });
  });

  return graphNodes;
}
