import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// `base: './'` produces relative asset URLs so the build works when served
// from a subpath. /api is proxied to the local backend during dev/preview;
// in production a reverse proxy (or VITE_API_URL) routes it instead.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
