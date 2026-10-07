import { defineConfig } from 'vite';
const developmentApi = process.env.DEV_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: developmentApi, changeOrigin: true },
      // Preserve the browser Origin for the gateway's explicit origin check.
      '/socket.io': { target: developmentApi, changeOrigin: false, ws: true },
    },
  },
});
