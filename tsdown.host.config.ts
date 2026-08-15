import { defineConfig } from 'tsdown'

/** Host half: ESM node bundle over the tsc-emitted lib/types tree. */
export default defineConfig({
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: id => id.startsWith('@deepseek-ai/') || id.startsWith('node:'),
  outputOptions: { entryFileNames: 'index.js' },
})
