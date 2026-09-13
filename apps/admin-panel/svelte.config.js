import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    paths: {
      base: '',
      // Keep generated URLs root-relative so navigation comparisons match
      // url.pathname on both the server and the client.
      relative: false
    }
  }
};

export default config;
