import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cp } from 'node:fs/promises';

// The media library lives at /assets in the repo root (it predates the Vite
// build and is referenced by external URLs). The dev server serves it from
// the project root as-is; for production builds we copy it into dist so the
// deployed site keeps the same /assets/... paths.
function copyAssets(): Plugin {
  return {
    name: 'fs-copy-assets',
    apply: 'build',
    async closeBundle() {
      await cp(resolve(__dirname, 'assets'), resolve(__dirname, 'dist/assets'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  base: './', // subpath-agnostic: works at friday-systems.com and /website/ on GitHub Pages
  publicDir: false,
  plugins: [copyAssets()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        legal: resolve(__dirname, 'legal.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
});
