/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode demo` builds a self-contained copy: relative asset paths and an
// in-memory router, so it runs from any folder or sandbox with no server
// rewrites and no dependence on the page URL.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages serves the site from /<repo>/; the workflow sets VITE_BASE.
  base: mode === 'demo' ? './' : process.env.VITE_BASE || '/',
  define: {
    __DEMO_BUILD__: JSON.stringify(mode === 'demo'),
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    sourcemap: false,
    // The hosted site loads each part of the app when it is first opened, so a
    // student never downloads the organiser screens. The demo is one file.
    cssCodeSplit: mode !== 'demo',
    rollupOptions: mode === 'demo' ? { output: { inlineDynamicImports: true } } : {},
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
