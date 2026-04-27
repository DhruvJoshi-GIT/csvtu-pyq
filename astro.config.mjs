import { defineConfig } from 'astro/config';

// GitHub Pages deploys at https://<user>.github.io/<repo>/
// so we set base to the repo name so links/assets resolve correctly.
export default defineConfig({
  site: 'https://dhruvjoshi-git.github.io',
  base: '/csvtu-pyq',
  output: 'static',
  build: {
    assets: '_assets',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
