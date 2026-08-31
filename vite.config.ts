import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cp, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// The media library lives at /assets in the repo root (it predates the Vite
// build and is referenced by external URLs). The dev server serves it from
// the project root as-is; for production builds we copy it into dist so the
// deployed site keeps the same /assets/... paths (kept even when the CDN is
// active, as a same-origin fallback and for the design_handoff prototype URLs).
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

// Media CDN indirection. MEDIA_BASE (env, set in the deploy workflow from the
// repo variable) prefixes every video URL — empty in dev / when unset, so the
// site keeps working same-origin. The manifest maps each mp4's repo path to a
// short content hash used as a ?v= cache-buster: the CDN can then cache
// immutably for a year, and replacing a video in the repo (same filename)
// still busts every visitor's cache on the next deploy.
const MEDIA_DIRS = ['assets/videos', 'assets/videos/mobile', 'assets/scrubs', 'assets/scrubs/mobile'];
async function mediaManifest(): Promise<Record<string, string>> {
  const vers: Record<string, string> = {};
  for (const dir of MEDIA_DIRS) {
    for (const f of await readdir(resolve(__dirname, dir))) {
      if (!f.endsWith('.mp4')) continue;
      const buf = await readFile(resolve(__dirname, dir, f));
      vers[dir + '/' + f] = createHash('sha1').update(buf).digest('hex').slice(0, 8);
    }
  }
  return vers;
}

export default defineConfig(async ({ command }) => {
  let mediaBase = process.env.MEDIA_BASE || '';
  if (mediaBase && !mediaBase.endsWith('/')) mediaBase += '/';
  // hashing reads every mp4 (~300MB) — build only; dev serves plain local paths
  const vers = command === 'build' ? await mediaManifest() : {};
  return {
    base: './', // subpath-agnostic: works at friday-systems.com and /website/ on GitHub Pages
    publicDir: false,
    plugins: [copyAssets()],
    define: {
      __MEDIA_BASE__: JSON.stringify(command === 'build' ? mediaBase : ''),
      __MEDIA_VERS__: JSON.stringify(vers),
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          legal: resolve(__dirname, 'legal.html'),
          privacy: resolve(__dirname, 'privacy.html'),
        },
      },
    },
  };
});
