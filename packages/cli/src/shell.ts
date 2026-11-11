import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json';

export const VERSION: string = pkg.version;
export const GENERATOR = { name: 'skillarium', version: VERSION };

/**
 * Content Security Policy of the viewer. Skill content is untrusted, so the
 * page may only run its own bundled script and only talk to its own origin.
 * (`style-src 'unsafe-inline'` is required by the graph library's inline
 * positioning styles; inline *scripts* stay forbidden.)
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Directory holding the built viewer (`index.html` + `assets/`). */
export function webDir(): string {
  const dir = fileURLToPath(new URL('../web', import.meta.url));
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw new Error(
      'The Skillarium viewer is missing from this installation. If you are working from source, run `pnpm build` first.',
    );
  }
  return dir;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ShellOptions {
  base: string;
  title?: string;
  description?: string;
}

/**
 * Turn the viewer's `index.html` into a page for a concrete base path. The
 * viewer is built with relative asset URLs (`./assets/…`); they are rewritten
 * to absolute ones so the same shell works at any route depth.
 */
export function renderShell(template: string, options: ShellOptions): string {
  const { base } = options;
  const head = [`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CONTENT_SECURITY_POLICY)}" />`];
  if (options.description) {
    head.push(`<meta name="description" content="${escapeHtml(options.description.slice(0, 300))}" />`);
  }
  let html = template
    .replace(/(\s(?:src|href)=")\.\//g, `$1${base}`)
    .replace('<meta name="skillarium-base" content="/" />', `<meta name="skillarium-base" content="${escapeHtml(base)}" />`)
    .replace('<!--skillarium:head-->', head.join('\n    '));
  if (options.title) {
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(options.title!)}</title>`);
  }
  return html;
}

const MIME: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function mimeType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}
