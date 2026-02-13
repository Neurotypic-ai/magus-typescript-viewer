import { fileURLToPath } from 'url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

import type { UserConfigExport } from 'vite';

const config: UserConfigExport = defineConfig({
  plugins: [
    vue(),
    nodePolyfills({
      globals: {
        process: true,
        Buffer: true,
      },
    }),
  ],
  server: {
    port: 4000,
    strictPort: true,
    hmr: {
      overlay: true,
      clientPort: 4000,
      host: 'localhost',
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'pinia'],
          'flow-vendor': ['@vue-flow/core', '@vue-flow/background', '@vue-flow/controls', '@vue-flow/minimap', '@vue-flow/node-toolbar'],
          'elk-vendor': ['elkjs'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vue', 'pinia', '@vue-flow/core', '@vue-flow/background', '@vue-flow/controls', '@vue-flow/minimap', '@vue-flow/node-toolbar'],
  },
  resolve: {
    dedupe: ['vue'],
    alias: {
      vue: fileURLToPath(new URL('./node_modules/vue', import.meta.url)),
    },
  },
  define: {
    'process.env': {},
    global: {},
    'process.version': JSON.stringify('v24.10.0'),
  },
});

export default config;
