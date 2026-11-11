// Refuse to pack an incomplete package, and ship the repository README/LICENSE.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const required of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'web/index.html']) {
  if (!fs.existsSync(path.join(pkg, required))) {
    console.error(`Missing ${required}. Run \`pnpm build\` from the repository root before packing.`);
    process.exit(1);
  }
}
for (const file of ['README.md', 'LICENSE']) {
  const source = path.resolve(pkg, '../..', file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(pkg, file));
}
