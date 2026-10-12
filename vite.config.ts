/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode demo` builds a self-contained copy: relative asset paths and an
// in-memory router, so it runs from any folder or sandbox with no server
// rewrites and no dependence on the page URL.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'demo' ? './' : '/',
  define: {
    __DEMO_BUILD__: JSON.stringify(mode === 'demo'),
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
