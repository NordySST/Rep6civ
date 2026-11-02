import { defineConfig } from 'vitest/config';

// base relativo: funciona em https://<user>.github.io/<repo>/ sem configuração extra
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
