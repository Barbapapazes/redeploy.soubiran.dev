import { defineConfig } from 'vitest/config'

// Unit tests don't need to start workerd or load the Cloudflare Vite plugin.
export default defineConfig({
  test: { maxWorkers: 1 },
})
