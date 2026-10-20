/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The hosted site's content security policy: scripts only from the site
 * itself, data only to the site and its Supabase project, fonts from Google.
 * A typed answer, a team name or a problem can never run code or send data
 * anywhere else. The demo copy runs inside another page and goes without.
 */
function csp(supabaseUrl: string | undefined): Plugin {
  let api = '';
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      api = ` ${u.origin} ${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`;
    }
  } catch {
    api = '';
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self'${api}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'mathcloud-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'same-origin' }, injectTo: 'head-prepend' },
    ],
  };
}

// `--mode demo` builds a self-contained copy: relative asset paths and an
// in-memory router, so it runs from any folder or sandbox with no server
// rewrites and no dependence on the page URL.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [] : [csp(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL)])],
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
