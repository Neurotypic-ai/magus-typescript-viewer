// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ApiServerResponder } from './ApiServerResponder';
import { Class } from '../shared/types/Class';
import { Interface } from '../shared/types/Interface';
import { isMethod, Method } from '../shared/types/Method';
import { Module } from '../shared/types/Module';
import { Property } from '../shared/types/Property';

function makeModule(): Module {
  return new Module(
    'mod-1',
    'pkg-1',
    'demo.ts',
    {
      directory: 'src',
      name: 'demo.ts',
      filename: 'demo.ts',
      relativePath: 'src/demo.ts',
    },
    '2024-01-01T00:00:00.000Z'
  );
}

function demoteMethod(method: Method): Method {
  return {
    id: method.id,
    package_id: method.package_id,
    module_id: method.module_id,
    parent_id: method.parent_id,
    name: method.name,
    created_at: method.created_at,
    parameters: method.parameters,
    return_type: method.return_type,
    is_static: method.is_static,
    is_async: method.is_async,
    visibility: method.visibility,
  } as unknown as Method;
}

function demoteProperty(property: Property): Property {
  return {
    id: property.id,
    package_id: property.package_id,
    module_id: property.module_id,
    parent_id: property.parent_id,
    name: property.name,
    created_at: property.created_at,
    type: property.type,
    is_static: property.is_static,
    is_readonly: property.is_readonly,
    visibility: property.visibility,
    default_value: property.default_value,
  } as unknown as Property;
}

function createResponder() {
  const responder = Object.create(ApiServerResponder.prototype) as ApiServerResponder & Record<string, unknown>;
  const mutableResponder = responder as unknown as Record<string, unknown>;
  const validClass = new Class('class-valid', 'pkg-1', 'mod-1', 'ValidClass', '2024-01-01T00:00:00.000Z');
  const invalidClass = {
    id: 'class-invalid',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'InvalidClass',
    created_at: '2024-01-01T00:00:00.000Z',
    methods: new Map(),
    properties: new Map(),
    implemented_interfaces: new Map(),
  };
  const validInterface = new Interface(
    'iface-valid',
    'pkg-1',
    'mod-1',
    'ValidInterface',
    '2024-01-01T00:00:00.000Z'
  );
  const invalidInterface = {
    id: 'iface-invalid',
    package_id: 'pkg-1',
    module_id: 'mod-1',
    name: 'InvalidInterface',
    created_at: '2024-01-01T00:00:00.000Z',
    methods: new Map(),
    properties: new Map(),
    extended_interfaces: new Map(),
  };
  const validClassMethod = new Method(
    'method-valid',
    'pkg-1',
    'mod-1',
    'class-valid',
    'run',
    '2024-01-01T00:00:00.000Z'
  );
  const validInterfaceMethod = new Method(
    'iface-method-valid',
    'pkg-1',
    'mod-1',
    'iface-valid',
    'describe',
    '2024-01-01T00:00:00.000Z'
  );
  const validClassProperty = new Property(
    'property-valid',
    'pkg-1',
    'mod-1',
    'class-valid',
    'status',
    '2024-01-01T00:00:00.000Z',
    'string'
  );
  const validInterfaceProperty = new Property(
    'iface-property-valid',
    'pkg-1',
    'mod-1',
    'iface-valid',
    'kind',
    '2024-01-01T00:00:00.000Z',
    'string'
  );
  const invalidClassMethod = demoteMethod(validClassMethod);
  const invalidInterfaceMethod = demoteMethod(validInterfaceMethod);
  const invalidClassProperty = demoteProperty(validClassProperty);
  const invalidInterfaceProperty = demoteProperty(validInterfaceProperty);

  mutableResponder['logger'] = {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  mutableResponder['moduleRepository'] = {
    retrieveAll: vi.fn().mockResolvedValue([makeModule()]),
  };
  mutableResponder['classRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([validClass, invalidClass]),
  };
  mutableResponder['interfaceRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([validInterface, invalidInterface]),
  };
  mutableResponder['functionRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([]),
  };
  mutableResponder['typeAliasRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([]),
  };
  mutableResponder['enumRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([]),
  };
  mutableResponder['variableRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([]),
  };
  mutableResponder['importRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([]),
  };
  mutableResponder['symbolReferenceRepository'] = {
    retrieveByModuleIds: vi.fn().mockResolvedValue([]),
  };
  mutableResponder['propertyRepository'] = {
    retrieveByParentIds: vi.fn().mockImplementation((ids: string[], parentType: 'class' | 'interface') => {
      if (parentType === 'class') {
        return new Map([
          [
            'class-valid',
            new Map([
              ['property-valid', validClassProperty],
              ['property-invalid', invalidClassProperty],
            ]),
          ],
          ['class-invalid', new Map([['property-skipped', invalidClassProperty]])],
          ...ids
            .filter((id) => id !== 'class-valid' && id !== 'class-invalid')
            .map((id) => [id, new Map()] as const),
        ]);
      }

      return new Map([
        [
          'iface-valid',
          new Map([
            ['iface-property-valid', validInterfaceProperty],
            ['iface-property-invalid', invalidInterfaceProperty],
          ]),
        ],
        ['iface-invalid', new Map([['iface-property-skipped', invalidInterfaceProperty]])],
        ...ids
          .filter((id) => id !== 'iface-valid' && id !== 'iface-invalid')
          .map((id) => [id, new Map()] as const),
      ]);
    }),
  };
  mutableResponder['methodRepository'] = {
    retrieveByParentIds: vi.fn().mockImplementation((ids: string[], parentType: 'class' | 'interface') => {
      if (parentType === 'class') {
        return new Map([
          [
            'class-valid',
            new Map([
              ['method-valid', validClassMethod],
              ['method-invalid', invalidClassMethod],
            ]),
          ],
          ['class-invalid', new Map([['method-skipped', invalidClassMethod]])],
          ...ids
            .filter((id) => id !== 'class-valid' && id !== 'class-invalid')
            .map((id) => [id, new Map()] as const),
        ]);
      }

      return new Map([
        [
          'iface-valid',
          new Map([
            ['iface-method-valid', validInterfaceMethod],
            ['iface-method-invalid', invalidInterfaceMethod],
          ]),
        ],
        ['iface-invalid', new Map([['iface-method-skipped', invalidInterfaceMethod]])],
        ...ids
          .filter((id) => id !== 'iface-valid' && id !== 'iface-invalid')
          .map((id) => [id, new Map()] as const),
      ]);
    }),
  };

  return { responder, validClassMethod, validInterfaceMethod, validClassProperty, validInterfaceProperty };
}

describe('ApiServerResponder', () => {
  it('filters non-hydrated classes, interfaces, and methods when building modules', async () => {
    const { responder, validClassMethod, validInterfaceMethod, validClassProperty, validInterfaceProperty } =
      createResponder();

    const modules = await responder.getModules('pkg-1');

    expect(modules).toHaveLength(1);

    const module = modules[0];
    const classes = module?.classes as Map<string, { methods: Map<string, Method>; properties: Map<string, Property> }>;
    const interfaces = module?.interfaces as Map<string, { methods: Map<string, Method>; properties: Map<string, Property> }>;
    const classEntry = classes.get('class-valid');
    const interfaceEntry = interfaces.get('iface-valid');

    expect(classes.size).toBe(1);
    expect(interfaces.size).toBe(1);
    expect(classes.has('class-invalid')).toBe(false);
    expect(interfaces.has('iface-invalid')).toBe(false);
    expect(classEntry).toBeDefined();
    expect(interfaceEntry).toBeDefined();
    expect(Array.from(classEntry?.methods.values() ?? [])).toEqual([validClassMethod]);
    expect(Array.from(interfaceEntry?.methods.values() ?? [])).toEqual([validInterfaceMethod]);
    expect(Array.from(classEntry?.properties.values() ?? [])).toEqual([validClassProperty]);
    expect(Array.from(interfaceEntry?.properties.values() ?? [])).toEqual([validInterfaceProperty]);
    expect(Array.from(classEntry?.methods.values() ?? []).every((method) => isMethod(method))).toBe(true);
    expect(Array.from(interfaceEntry?.methods.values() ?? []).every((method) => isMethod(method))).toBe(true);
  });
});
