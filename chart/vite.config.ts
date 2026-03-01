import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],

  // Replace Node.js globals that React/ReactDOM reference internally.
  // In IIFE lib mode Vite does NOT inject these automatically — without this
  // the bundle throws "process is not defined" at runtime in the browser.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env':          '{}',
    'global':               'globalThis',
  },

  build: {
    outDir: '../js/chart',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/main.tsx'),
      name: 'YamatoChart',
      formats: ['iife'],
      fileName: () => 'chart.js',
    },
    rollupOptions: {
      // Bundle everything — React, ReactDOM, lightweight-charts all in the IIFE
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
  },
});
