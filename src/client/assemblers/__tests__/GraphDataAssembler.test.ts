import { afterEach, describe, expect, it, vi } from 'vitest';

import { GraphDataAssembler } from '../GraphDataAssembler';
import { GraphDataCache } from '../graphDataCache';

describe('GraphDataAssembler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    GraphDataCache.getInstance().clear();
  });

  it('preserves exports, reference paths, and rich member metadata from graph summary payloads', async () => {
    const summaryPayload = {
      packages: [
        {
          id: 'pkg-1',
          name: 'magus-typescript-viewer',
          version: '1.0.0',
          path: '/tmp/magus-typescript-viewer',
          created_at: '2026-03-14T00:00:00.000Z',
          dependencies: [],
          devDependencies: [],
          peerDependencies: [],
          modules: [
            {
              id: 'module-1',
              package_id: 'pkg-1',
              name: 'GraphDataAssembler',
              source: {
                relativePath: 'src/client/assemblers/GraphDataAssembler.ts',
              },
              created_at: '2026-03-14T00:00:00.000Z',
              referencePaths: ['src/client/App.vue'],
              imports: [],
              exports: [
                {
                  uuid: 'export-1',
                  module: 'module-1',
                  name: 'GraphDataAssembler',
                  isDefault: false,
                  imports: [],
                },
                {
                  uuid: 'export-2',
                  module: 'module-1',
                  name: 'default',
                  localName: 'GraphDataAssembler',
                  isDefault: true,
                  imports: [],
                },
              ],
              packages: [],
              typeAliases: [],
              enums: [],
              functions: [],
              variables: [],
              symbol_references: [],
              classes: [
                {
                  id: 'class-1',
                  package_id: 'pkg-1',
                  module_id: 'module-1',
                  name: 'GraphAssembler',
                  created_at: '2026-03-14T00:00:00.000Z',
                  implemented_interfaces: [],
                  properties: [
                    {
                      id: 'property-1',
                      package_id: 'pkg-1',
                      module_id: 'module-1',
                      parent_id: 'class-1',
                      name: 'cache',
                      created_at: '2026-03-14T00:00:00.000Z',
                      type: 'GraphDataCache',
                      is_static: false,
                      is_readonly: true,
                      visibility: 'private',
                      default_value: 'GraphDataCache.getInstance()',
                    },
                  ],
                  methods: [
                    {
                      id: 'method-1',
                      package_id: 'pkg-1',
                      module_id: 'module-1',
                      parent_id: 'class-1',
                      name: 'assemble',
                      created_at: '2026-03-14T00:00:00.000Z',
                      parameters: [
                        {
                          id: 'param-1',
                          parent_id: 'method-1',
                          name: 'force',
                          type: 'boolean',
                          created_at: '2026-03-14T00:00:00.000Z',
                        },
                      ],
                      return_type: 'Promise<void>',
                      is_static: true,
                      is_async: true,
                      visibility: 'public',
                    },
                  ],
                },
              ],
              interfaces: [],
            },
          ],
        },
      ],
    };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => summaryPayload,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const cache = GraphDataCache.getInstance();
    const assembler = new GraphDataAssembler('http://localhost:4001', cache);

    const graphData = await assembler.assembleGraphData();
    const module = graphData.packages[0]?.modules?.['module-1'];
    const graphClass = module?.classes?.['GraphAssembler'];

    expect(module?.referencePaths).toEqual(['src/client/App.vue']);
    expect(module?.exports).toEqual([
      {
        uuid: 'export-1',
        name: 'GraphDataAssembler',
        isDefault: false,
      },
      {
        uuid: 'export-2',
        name: 'default',
        localName: 'GraphDataAssembler',
        isDefault: true,
      },
    ]);
    expect(graphClass?.properties).toEqual([
      {
        id: 'property-1',
        name: 'cache',
        type: 'GraphDataCache',
        visibility: 'private',
        isStatic: false,
        isReadonly: true,
        defaultValue: 'GraphDataCache.getInstance()',
      },
    ]);
    expect(graphClass?.methods).toEqual([
      {
        id: 'method-1',
        name: 'assemble',
        returnType: 'Promise<void>',
        visibility: 'public',
        signature: 'force: boolean',
        isStatic: true,
        isAsync: true,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
