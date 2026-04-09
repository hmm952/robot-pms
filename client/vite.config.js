import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 开发时将 /api 代理到后端，避免 CORS 与跨端口问题
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
