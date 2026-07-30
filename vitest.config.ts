import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string, entry = 'src/index.ts'): string =>
  fileURLToPath(new URL(`./packages/${name}/${entry}`, import.meta.url));

// Workspace packages are aliased straight at source so `pnpm test` needs no
// build step. Production consumers resolve the built `dist/` via package.json
// exports; the alias exists only for the test runner.
export default defineConfig({
  resolve: {
    alias: {
      // Longest-prefix first: the subpath alias must win over the bare one.
      '@boring/tariff-schema/testing': pkg('tariff-schema', 'src/testing/index.ts'),
      '@boring/tariff-schema': pkg('tariff-schema'),
      '@boring/rating-engine': pkg('rating-engine'),
      '@boring/fixture-harness': pkg('fixture-harness'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // The money path is deterministic; a flaky retry would hide a real bug.
    retry: 0,
  },
});
