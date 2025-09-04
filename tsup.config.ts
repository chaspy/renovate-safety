import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/mastra/config/**/*.ts',
    'src/mastra/tools/**/*.ts',
    'src/mastra/agents/**/*.ts',
    'src/mastra/workflows/**/*.ts',
    'src/mastra/cli/**/*.ts',
  ],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: true,
  sourcemap: true,
  shims: true,
  minify: false,
  splitting: false,
  treeshake: true,
  external: [
    '@octokit/rest',
    '@ai-sdk/openai', 
    '@mastra/core',
    'zod'
  ],
});