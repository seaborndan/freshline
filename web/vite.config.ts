// defineConfig is imported from vitest/config rather than vite, because Vite's own
// UserConfig type has no knowledge of the `test` block. Vitest re-exports an extended
// version of it. Importing from 'vite' here compiles under `vite build` but fails
// `tsc -b`, which is exactly the kind of thing CI should catch and did.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // MapLibre loads its tile-parsing worker with `new Worker(new URL(…))`, and Vite's dependency
  // pre-bundler rewrites that URL to a file it does not then emit — `maplibre-gl-worker.mjs`. The
  // failure is quiet and total: the worker never starts, the style never finishes loading, `load`
  // never fires, and the canvas stays blank while the rest of the page behaves normally. It only
  // affects the dev server, which is the one place a blank map is easiest to blame on your own code.
  //
  // Excluding the package from pre-bundling leaves the worker URL alone.
  optimizeDeps: { exclude: ['maplibre-gl'] },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
  },
})
