import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  // Relative asset paths: the build works from any sub-path (GitHub Pages project site, local server, …).
  base: './',
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
