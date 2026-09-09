import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// One suite for the whole workspace. Workspace imports resolve to TypeScript
// sources so tests never need a build.
export default defineConfig({
  resolve: {
    alias: {
      '@agent-console/contracts': fileURLToPath(
        new URL('packages/contracts/src/index.ts', import.meta.url),
      ),
      // The web app's own alias, so its modules can be tested where they sit.
      '@': fileURLToPath(new URL('apps/web/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
