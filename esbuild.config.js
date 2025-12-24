import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: !production,
  minify: production,
  tsconfig: path.join(__dirname, 'tsconfig.json'),
  external: [
    // Node.js built-ins (important for ESM)
    'node:*',
    // native/binary-heavy libs should be excluded
    '@duckdb/node-api',
    // keep vite out of the CLI bundle; it's imported dynamically at runtime
    'vite',
    'lightningcss',
    'fsevents',
  ],
  logLevel: 'info',
  loader: {
    '.sql': 'text',
  },
  packages: 'external', // Don't bundle node_modules
};

async function build() {
  await fs.promises.mkdir(path.join(__dirname, 'dist', 'bin'), { recursive: true });

  // CLI bin - ESM format for Node 24+
  await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, 'src/server/bin/typescript-viewer.ts')],
    outfile: path.join(__dirname, 'dist/bin/typescript-viewer.js'),
    format: 'esm',
    banner: { js: '#!/usr/bin/env node\n' },
  });

  // API server - ESM format
  await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, 'src/server.ts')],
    outfile: path.join(__dirname, 'dist/server.js'),
    format: 'esm',
  });

  // Copy schema.sql next to the bundled server for runtime filesystem loading
  const schemaSrc = path.join(__dirname, 'src/server/db/schema/schema.sql');
  const schemaDst = path.join(__dirname, 'dist', 'schema.sql');
  await fs.promises.copyFile(schemaSrc, schemaDst);

  // Also copy schema.sql to dist/bin for CLI
  const schemaBinDst = path.join(__dirname, 'dist', 'bin', 'schema.sql');
  await fs.promises.copyFile(schemaSrc, schemaBinDst);

  // Make CLI executable
  await fs.promises.chmod(path.join(__dirname, 'dist/bin/typescript-viewer.js'), 0o755);
}

void build();
