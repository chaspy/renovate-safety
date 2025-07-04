import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: true,
  sourcemap: true,
  shims: true,
  minify: false,
  splitting: false,
  treeshake: true,
});