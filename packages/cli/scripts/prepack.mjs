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
fs.copyFileSync(path.resolve(pkg, '../..', 'LICENSE'), path.join(pkg, 'LICENSE'));

// The README is written for the repository, where `docs/…` and `LICENSE` are
// files next to it. On npmjs.com they are not, so point them at GitHub.
const { repository } = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
const repo = repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const raw = repo.replace('https://github.com/', 'https://raw.githubusercontent.com/');
const isRelative = (target) => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target);
const readme = fs
  .readFileSync(path.resolve(pkg, '../..', 'README.md'), 'utf8')
  .replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (m, a, target, b) =>
    isRelative(target) ? `${a}${raw}/main/${target}${b}` : m,
  )
  .replace(/(<a\b[^>]*?\bhref=")([^"]+)(")/g, (m, a, target, b) =>
    isRelative(target) ? `${a}${repo}/blob/main/${target}${b}` : m,
  )
  .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang, text, target) =>
    isRelative(target) ? `${bang}[${text}](${bang ? raw : repo + '/blob'}/main/${target})` : m,
  );
fs.writeFileSync(path.join(pkg, 'README.md'), readme);
