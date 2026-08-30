import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/chat': 'http://localhost:8787',
      '/materials': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    clearMocks: true,
    restoreMocks: true,
  },
})
