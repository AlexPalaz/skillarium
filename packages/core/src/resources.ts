import fs from 'node:fs/promises';
import type { PreviewKind, ResourceKind } from './model.js';

/** Text files larger than this are listed but their content is not published. */
export const MAX_TEXT_BYTES = 512 * 1024;
/** Images larger than this are listed but not published. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** SKILL.md files larger than this are not rendered. */
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;
/** Upper bound of indexed files per skill. */
export const MAX_FILES_PER_SKILL = 500;

/** Extension → highlight.js language id. */
const TEXT_LANGUAGES: Record<string, string> = {
  bash: 'bash', c: 'c', cfg: 'ini', cjs: 'javascript', conf: 'ini', cpp: 'cpp', cs: 'csharp',
  css: 'css', csv: 'plaintext', diff: 'diff', go: 'go', graphql: 'graphql', h: 'c', hpp: 'cpp',
  htm: 'xml', html: 'xml', ini: 'ini', java: 'java', js: 'javascript', json: 'json',
  jsonl: 'json', jsx: 'javascript', kt: 'kotlin', less: 'less', lua: 'lua', mjs: 'javascript',
  mts: 'typescript', php: 'php', pl: 'perl', ps1: 'powershell', py: 'python', r: 'r',
  rb: 'ruby', rs: 'rust', scss: 'scss', sh: 'bash', sql: 'sql', svg: 'xml', swift: 'swift',
  tex: 'plaintext', toml: 'ini', ts: 'typescript', tsv: 'plaintext', tsx: 'typescript',
  txt: 'plaintext', xml: 'xml', yaml: 'yaml', yml: 'yaml', zsh: 'bash',
};

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/**
 * Raster formats only. SVG is deliberately previewed as source text: served
 * as an image document it could run script on the site's origin.
 */
const IMAGE_TYPES: Record<string, string> = {
  avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp',
};

export interface Classification {
  preview: PreviewKind;
  language?: string;
  contentType?: string;
  omitted?: 'too-large' | 'unsupported';
}

export function resourceKind(relPath: string): ResourceKind {
  const top = relPath.includes('/') ? relPath.slice(0, relPath.indexOf('/')) : '';
  if (top === 'scripts') return 'script';
  if (top === 'references') return 'reference';
  if (top === 'assets') return 'asset';
  return 'other';
}

function extensionOf(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Heuristic for files without a known extension: UTF-8 and no NUL bytes. */
async function looksLikeText(abs: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(abs, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) return false;
    // A multi-byte sequence may be cut at the sample edge; do not be fatal there.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** Decide how (and whether) a file's content may be previewed and published. */
export async function classifyFile(
  relPath: string,
  abs: string,
  size: number,
): Promise<Classification> {
  const ext = extensionOf(relPath);

  const imageType = IMAGE_TYPES[ext];
  if (imageType) {
    return size > MAX_IMAGE_BYTES
      ? { preview: 'image', omitted: 'too-large' }
      : { preview: 'image', contentType: imageType };
  }

  let preview: PreviewKind | undefined;
  let language: string | undefined;
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    preview = 'markdown';
    language = 'markdown';
  } else if (TEXT_LANGUAGES[ext]) {
    preview = 'text';
    language = TEXT_LANGUAGES[ext];
  } else if (size === 0 || (await looksLikeText(abs))) {
    preview = 'text';
    language = 'plaintext';
  }

  if (!preview) return { preview: 'none', omitted: 'unsupported' };
  if (size > MAX_TEXT_BYTES) return { preview, language, omitted: 'too-large' };
  return { preview, language, contentType: 'text/plain; charset=utf-8' };
}
