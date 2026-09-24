// ABOUTME: Vite and Vitest configuration for the emditor web app.
// ABOUTME: In development, API and file requests go to the Rust server on port 4747.

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4747',
      '/files': 'http://127.0.0.1:4747',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
})
