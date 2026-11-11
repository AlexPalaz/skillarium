// Copy the built viewer into the CLI package so it ships in the npm tarball.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../web/dist');
const target = path.resolve(here, '../web');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error('Viewer build not found. Run `pnpm --filter @skillarium/web build` first.');
  process.exit(1);
}
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Copied viewer to ${path.relative(process.cwd(), target)}`);
