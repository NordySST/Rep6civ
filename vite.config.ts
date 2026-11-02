import { defineConfig } from 'vitest/config';

// base relativo: funciona em https://<user>.github.io/<repo>/ sem configuração extra
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    // o módulo 3D (three.js) é carregado sob demanda num pedaço próprio (~600 kB)
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
