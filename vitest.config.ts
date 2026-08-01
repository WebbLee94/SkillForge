import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html', 'lcov'],
    reportsDirectory: './coverage',
    include: ['src/**/*.{ts,tsx}'],
    exclude: ['src/**/*.d.ts', 'src/**/__tests__/**'],
    thresholds: {
      lines: 60,
      functions: 60,
      branches: 50,
      statements: 60,
    },
  },
});