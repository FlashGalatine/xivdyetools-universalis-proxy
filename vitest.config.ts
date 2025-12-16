import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns
    include: ['src/**/*.test.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**/*.ts', // Type definitions don't need coverage
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },

    // Global test settings
    globals: true,

    // Setup files
    setupFiles: ['./src/test-setup.ts'],

    // Timeout for async tests
    testTimeout: 10000,
  },
});
