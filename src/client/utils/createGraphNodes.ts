// import { getMembersAsProperties } from '../components/DependencyGraph';
import { Position } from '@vue-flow/core';

import { mapTypeCollection } from '../components/DependencyGraph/mapTypeCollection';
import { getNodeStyle } from '../theme/graphTheme';

import type {
  DependencyKind,
  DependencyNode,
  DependencyPackageGraph,
  ImportRef,
  ModuleStructure,
} from '../components/DependencyGraph/types';

/**
 * Creates empty items that match the expected interface for getMembersAsProperties
 */
// function createCompatibleTypeInput(item: ClassStructure | InterfaceStructure) {
//   return {
//     id: item.id,
//     name: item.name,
//     properties: [],
//     methods: [],
//   };
// }

/**
 * Creates graph nodes from the provided dependency package graph data
 * @param data The dependency package graph data
 * @param options Configuration options for node creation
 * @returns Array of dependency nodes
 */
export function createGraphNodes(
  data: DependencyPackageGraph,
  options: {
    includePackages?: boolean;
    includeModules?: boolean;
    includeClasses?: boolean;
    includeClassNodes?: boolean;
    includeInterfaceNodes?: boolean;
    nestSymbolsInModules?: boolean;
    direction?: 'LR' | 'RL' | 'TB' | 'BT';
  } = {}
): DependencyNode[] {
  const {
    includePackages = false,
    includeModules = true,
    includeClasses = false,
    includeClassNodes = includeClasses,
    includeInterfaceNodes = includeClasses,
    nestSymbolsInModules = true,
    direction = 'LR',
  } = options;

  // Calculate handle positions based on layout direction
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

  // Optionally create package nodes
  if (includePackages) {
    data.packages.forEach((pkg) => {
      graphNodes.push({
        id: pkg.id,
        type: 'package' as DependencyKind,
        position: { x: 0, y: 0 },
        sourcePosition,
        targetPosition,
        expandParent: true,
        data: {
          label: pkg.name,
          properties: [{ name: 'version', type: pkg.version, visibility: 'public' }],
        },
        style: {
          ...getNodeStyle('package'),
        },
      });
    });
  }

  // Create module nodes and symbol nodes
  data.packages.forEach((pkg) => {
    if (!pkg.modules) return;

    mapTypeCollection(pkg.modules, (module) => {
      if (includeModules) {
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
            properties: [
              { name: 'package', type: pkg.name, visibility: 'public' },
              { name: 'path', type: module.source.relativePath || '', visibility: 'public' },
            ],
          },
          style: {
            ...getNodeStyle('module'),
          },
        };

        // Only add parent relationship if packages are included
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

      // Optionally add class nodes
      if (includeClassNodes && module.classes) {
        mapTypeCollection(module.classes, (cls) => {
          const properties = cls.properties
            ? mapTypeCollection(cls.properties, (prop) => ({
                name: prop.name,
                type: prop.type,
                visibility: prop.visibility,
              }))
            : [];

          const methods = cls.methods
            ? mapTypeCollection(cls.methods, (method) => {
                const returnType: string = (method.returnType as string | undefined) ?? 'void';
                const methodName: string = method.name;
                const visibility: string = method.visibility;
                return {
                  name: methodName,
                  returnType,
                  visibility,
                  signature: `${methodName}(): ${returnType}`,
                };
              })
            : [];

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
            },
            style: {
              ...getNodeStyle('class'),
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

      // Optionally add interface nodes
      if (includeInterfaceNodes && module.interfaces) {
        mapTypeCollection(module.interfaces, (iface) => {
          const properties = iface.properties
            ? mapTypeCollection(iface.properties, (prop) => ({
                name: prop.name,
                type: prop.type,
                visibility: prop.visibility,
              }))
            : [];

          const methods = iface.methods
            ? mapTypeCollection(iface.methods, (method) => {
                const returnType: string = (method.returnType as string | undefined) ?? 'void';
                const methodName: string = method.name;
                const visibility: string = method.visibility;
                return {
                  name: methodName,
                  returnType,
                  visibility,
                  signature: `${methodName}(): ${returnType}`,
                };
              })
            : [];

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
            },
            style: {
              ...getNodeStyle('interface'),
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
