import { defineConfig } from 'vite';
import { BACKEND_ORIGIN } from './src/config';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/socket.io': { target: BACKEND_ORIGIN, changeOrigin: true, ws: true },
    },
  },
});
