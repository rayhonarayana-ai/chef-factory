import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/integration/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
