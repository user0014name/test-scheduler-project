import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test-fixtures.ts',
        'src/sample-data.ts',
        'src/scenarios/**',
        'src/index.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
