import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ['lucide-svelte']
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000
    },
    host: '0.0.0.0',
    port: 3000,
    hmr: {
      clientPort: 8088
    }
  }
});
