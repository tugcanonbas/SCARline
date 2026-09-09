import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    paths: {
      base: '/admin',
      // Keep `base` (and therefore appPath()) an absolute "/admin" string.
      // SvelteKit's default (relative: true) makes `base` a context-relative
      // value (e.g. "."), which breaks the isActive() path comparisons in
      // +layout.svelte and StudyTabs.svelte even though links still resolve
      // correctly by coincidence.
      relative: false
    }
  }
};

export default config;
