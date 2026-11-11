import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: 'esm',
  target: 'node20',
  platform: 'node',
  clean: true,
  // Type declarations are emitted by `tsc -p tsconfig.dts.json` (see package.json).
  // The core package is private to this repository: bundle it into the CLI.
  noExternal: ['@skillarium/core'],
});
