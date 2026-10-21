import { defineConfig } from 'vite';
const developmentApi = process.env.DEV_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  server: {
    // Avoid Windows resolving `localhost` to IPv6 (::1), which can fail with
    // EACCES on machines where IPv6 loopback binding is restricted.
    host: '127.0.0.1',
    // Port 5173 can fall inside a Windows/Hyper-V reserved port range.
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: developmentApi, changeOrigin: true },
      // Preserve the browser Origin for the gateway's explicit origin check.
      '/socket.io': { target: developmentApi, changeOrigin: false, ws: true },
    },
  },
});
