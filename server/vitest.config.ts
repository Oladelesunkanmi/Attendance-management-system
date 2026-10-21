import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The API tests exercise Express and jose, which need the Node realm.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
