import { defineConfig } from 'vite'
import { resolve } from 'path'

// The worker is built as a classic script (IIFE), not an ES module, so the
// same file serves Chrome's `background.service_worker` and Firefox's
// `background.scripts`.
export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        format: 'iife',
        inlineDynamicImports: true
      }
    }
  }
})
