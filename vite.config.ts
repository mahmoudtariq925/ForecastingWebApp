import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// `base: './'` produces relative asset URLs so the build works when served
// from a GitHub Pages project subpath (e.g. /ForecastingWebApp/).
export default defineConfig({
  plugins: [react()],
  base: './',
});
