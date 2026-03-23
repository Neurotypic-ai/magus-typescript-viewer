import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Class, isClass } from '../../shared/types/Class';
import { Interface, isInterface } from '../../shared/types/Interface';
import { isMethod } from '../../shared/types/Method';
import { EntityRegistry } from './EntityRegistry';
import { GraphDataCache } from './graphDataCache';
import { GraphHydrator } from './GraphHydrator';

function demoteClassInstance(entity: Class): Class {
  return {
    id: entity.id,
    package_id: entity.package_id,
    module_id: entity.module_id,
    name: entity.name,
    created_at: entity.created_at,
    methods: entity.methods,
    properties: entity.properties,
    implemented_interfaces: entity.implemented_interfaces,
    extends_id: entity.extends_id,
  } as unknown as Class;
}

function demoteInterfaceInstance(entity: Interface): Interface {
  return {
    id: entity.id,
    package_id: entity.package_id,
    module_id: entity.module_id,
    name: entity.name,
    created_at: entity.created_at,
    methods: entity.methods,
    properties: entity.properties,
    extended_interfaces: entity.extended_interfaces,
  } as unknown as Interface;
}

function makeGraphPayload(includeInterface = true) {
  return {
    packages: [
      {
        id: 'pkg-1',
        name: 'demo',
        version: '1.0.0',
        path: '/demo',
        created_at: '2024-01-01T00:00:00.000Z',
        modules: [
          {
            id: 'mod-1',
            package_id: 'pkg-1',
            name: 'demo.ts',
            source: { relativePath: 'src/demo.ts' },
            created_at: '2024-01-01T00:00:00.000Z',
            classes: [
              {
                id: 'cls-1',
                package_id: 'pkg-1',
                module_id: 'mod-1',
                name: 'DemoClass',
                created_at: '2024-01-01T00:00:00.000Z',
                methods: [
                  {
                    id: 'method-1',
                    package_id: 'pkg-1',
                    module_id: 'mod-1',
                    parent_id: 'cls-1',
                    name: 'run',
                    created_at: '2024-01-01T00:00:00.000Z',
                    parameters: [],
                    return_type: 'void',
                    is_static: false,
                    is_async: false,
                    visibility: 'public',
                  },
                ],
                properties: [],
                implemented_interfaces: [],
              },
            ],
            interfaces: includeInterface
              ? [
                  {
                    id: 'iface-1',
                    package_id: 'pkg-1',
                    module_id: 'mod-1',
                    name: 'DemoInterface',
                    created_at: '2024-01-01T00:00:00.000Z',
                    methods: [],
                    properties: [],
                    extended_interfaces: [],
                  },
                ]
              : [],
            functions: [],
            typeAliases: [],
            enums: [],
            variables: [],
            imports: [],
            symbol_references: [],
          },
        ],
      },
    ],
  };
}

describe('GraphHydrator', () => {
  const cache = GraphDataCache.getInstance();

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cache.clear();
  });

  it('hydrates class, interface, and method instances that satisfy shared guards', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeGraphPayload()),
    } as Response);

    const hydrator = new GraphHydrator('http://example.test', cache);

    const graph = await hydrator.assembleGraphData();
    const pkg = graph.packages[0];
    const module = Array.from((pkg?.modules as Map<string, unknown>).values())[0] as {
      classes: Map<string, unknown>;
      interfaces: Map<string, unknown>;
    };
    const cls = Array.from(module.classes.values())[0];
    const iface = Array.from(module.interfaces.values())[0];
    const method = Array.from(((cls as { methods: Map<string, unknown> }).methods).values())[0];

    expect(isClass(cls)).toBe(true);
    expect(isInterface(iface)).toBe(true);
    expect(isMethod(method)).toBe(true);
  });

  it('throws when registry registration breaks class hydration', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeGraphPayload(false)),
    } as Response);
    vi.spyOn(EntityRegistry.prototype, 'register').mockImplementation(function register(_id, entity) {
      if (entity instanceof Class) {
        return demoteClassInstance(entity);
      }

      return entity;
    });

    const hydrator = new GraphHydrator('http://example.test', cache);

    await expect(hydrator.assembleGraphData()).rejects.toThrow(/expected hydrated class instance/i);
  });

  it('throws when registry registration breaks interface hydration', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeGraphPayload(true)),
    } as Response);
    vi.spyOn(EntityRegistry.prototype, 'register').mockImplementation(function register(_id, entity) {
      if (entity instanceof Interface) {
        return demoteInterfaceInstance(entity);
      }

      return entity;
    });

    const hydrator = new GraphHydrator('http://example.test', cache);

    await expect(hydrator.assembleGraphData()).rejects.toThrow(/expected hydrated interface instance/i);
  });
});
