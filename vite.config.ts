import { defineConfig } from 'vite';

// The published game lives under /los-gatos/ on GitHub Pages; locally it is served from the root.
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
});
