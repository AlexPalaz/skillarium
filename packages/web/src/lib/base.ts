/**
 * The site base path, injected by the CLI into the page shell. Every data and
 * file URL is built from it, so the same viewer works at `/` and at
 * `/my-project/` (GitHub Pages).
 */
function readBase(): string {
  const value = document.querySelector('meta[name="skillarium-base"]')?.getAttribute('content') || '/';
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export const BASE = readBase();

/**
 * Router basename. The trailing slash is kept on purpose: it makes the home
 * link `/base/` rather than `/base`, which a static host would redirect.
 */
export const ROUTER_BASENAME = BASE;

/** Absolute URL for a path relative to the site base, e.g. `data/catalog.json`. */
export function siteUrl(relative: string): string {
  return BASE + relative.replace(/^\/+/, '');
}

export function skillPath(id: string, file?: string): string {
  const base = `/skills/${id}/`;
  return file ? `${base}?file=${encodeURIComponent(file)}` : base;
}
