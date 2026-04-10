import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.e2e.test.ts'],
      environment: 'node',
      typecheck: { enabled: false },
    },
  },
  {
    test: {
      name: 'e2e',
      include: ['src/**/*.e2e.test.ts'],
      environment: 'node',
      typecheck: { enabled: false },
      testTimeout: 30_000,
    },
  },
]);
