// Copy the fixture that tests modify into a scratch directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '.tmp', 'hostile');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(here, 'fixtures', 'hostile'), target, { recursive: true });
