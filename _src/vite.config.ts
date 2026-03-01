import { defineConfig } from 'vite';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';
import { resolve } from 'path';

export default defineConfig({
  plugins: [cssInjectedByJs()],

  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env':          '{}',
    'global':               'globalThis',
  },

  build: {
    outDir: '../js/chart',
    emptyOutDir: true,
    lib: {
      entry:    resolve(__dirname, 'src/main.ts'),
      name:     'YamatoChart',
      formats:  ['iife'],
      fileName: () => 'chart.js',
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
  },
});
