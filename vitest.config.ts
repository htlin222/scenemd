import { defineConfig } from 'vitest/config'

// A separate config from vite.config.ts on purpose: the app build pulls in the
// React plugin and PWA service-worker generation, neither of which the engine
// tests need. The deterministic core is pure functions over Markdown, so these
// run in node with no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
