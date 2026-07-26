// defineConfig is imported from vitest/config rather than vite, because Vite's own
// UserConfig type has no knowledge of the `test` block. Vitest re-exports an extended
// version of it. Importing from 'vite' here compiles under `vite build` but fails
// `tsc -b`, which is exactly the kind of thing CI should catch and did.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
  },
})
