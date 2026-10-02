import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url))

// The browser only ever talks to its own origin; the dev server and `vite preview` forward /api.
const api = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } }

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, proxy: api },
  preview: { port: 4173, proxy: api },
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { index: page('index'), preview: page('preview'), place: page('place') },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
