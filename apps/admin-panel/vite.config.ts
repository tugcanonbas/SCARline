import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  optimizeDeps: {
    exclude: ['lucide-svelte']
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000
    },
    host: '0.0.0.0',
    port: 5173
  }
});
