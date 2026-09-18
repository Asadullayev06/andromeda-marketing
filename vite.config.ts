import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Sales frontend calls /api/* → forwarded to the marketing_control FastAPI
// backend on :8010 (separate from ANDROMEDA's :8000). Both hit the same DB.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
