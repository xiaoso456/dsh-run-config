import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    // `tests/runs/**` is gitignored run-artifact territory (`.gitignore`), and
    // the recursive `include` above would collect the `*.spec.ts` probes that
    // land in there and run them as if they were the production suite.
    exclude: [...configDefaults.exclude, 'tests/runs/**'],
  },
})
