import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// vite-plugin-static-copy is optional — install it if you want the build to
// copy charting_library from _src/public/charting_library/ to ../charting_library/.
// Alternatively, place the TV library files directly in /charting_library/
// at the project root (served by express via express.static).
//
// To enable: npm install -D vite-plugin-static-copy
// Then uncomment the import and plugin below.
//
// import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    // viteStaticCopy({
    //   targets: [{
    //     src:  'public/charting_library',
    //     // dest is relative to outDir (../js/chart), so ../../ = project root
    //     dest: '../../charting_library',
    //   }],
    // }),
  ],

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
      // Bundle React and the datafeed into the IIFE.
      // TradingView charting_library.js is loaded separately as a <script> tag
      // and is accessed via window.TradingView — NOT bundled here.
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
  },
});
