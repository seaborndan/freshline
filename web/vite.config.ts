// defineConfig is imported from vitest/config rather than vite, because Vite's own
// UserConfig type has no knowledge of the `test` block. Vitest re-exports an extended
// version of it. Importing from 'vite' here compiles under `vite build` but fails
// `tsc -b`, which is exactly the kind of thing CI should catch and did.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * A production build refuses to run without `VITE_API_BASE_URL`.
 *
 * `client.ts` falls back to the `dotnet run` address when the variable is missing, which is right in
 * development and is a trap in a build: the fallback is `http://localhost:5045`, so a bundle built
 * without the variable would ship to a real URL and ask **the visitor's own machine** for data. Every
 * request fails, and it fails looking exactly like the API being down — the deployed site is wrong in
 * a way that points at the wrong thing.
 *
 * Vite substitutes `import.meta.env` at build time, so this is the last moment the mistake is
 * catchable. Failing here means there is no artifact to deploy rather than a broken one.
 *
 * Development is untouched: `npm run dev` never reaches this, and the fallback stays useful.
 */
function requireApiBaseUrl(mode: string) {
  if (mode !== 'production' || process.env.VITE_API_BASE_URL) {
    return
  }

  throw new Error(
    'VITE_API_BASE_URL is not set. A production build without it would ship a site that calls ' +
      "http://localhost:5045 — the visitor's own machine. Set it to the deployed API's origin, " +
      'for example VITE_API_BASE_URL=https://freshline-api.example.com npm run build.',
  )
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    requireApiBaseUrl(mode)
  }

  return {
    plugins: [react()],

    // MapLibre loads its tile-parsing worker with `new Worker(new URL(…))`, and Vite's dependency
    // pre-bundler rewrites that URL to a file it does not then emit — `maplibre-gl-worker.mjs`. The
    // failure is quiet and total: the worker never starts, the style never finishes loading, `load`
    // never fires, and the canvas stays blank while the rest of the page behaves normally. It only
    // affects the dev server, which is the one place a blank map is easiest to blame on your own
    // code.
    //
    // Excluding the package from pre-bundling leaves the worker URL alone.
    optimizeDeps: { exclude: ['maplibre-gl'] },

    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/setupTests.ts'],
      css: false,
    },
  }
})
