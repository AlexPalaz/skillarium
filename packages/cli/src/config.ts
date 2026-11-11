import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

/** Options accepted in `skillarium.config.ts`. Every field is optional. */
export interface SkillariumConfig {
  /** Name shown in the viewer. Defaults to the project directory name. */
  title?: string;
  description?: string;
  /**
   * Directories to scan for skills, relative to the project root. When
   * omitted, the well-known locations (`skills`, `.claude/skills`,
   * `.agents/skills`, …) are searched.
   */
  skills?: string[];
  /** Extra ignore patterns in gitignore syntax, relative to the project root. */
  ignore?: string[];
  /** Output directory of `skillarium build`. Default: `./skillarium-dist`. */
  outDir?: string;
  /** Public base path of the static site, e.g. `/my-repo/` for GitHub Pages. Default: `/`. */
  base?: string;
  /** Repository URL shown in the top navigation. */
  repository?: string;
  /**
   * Template for "view source" links; `{path}` is replaced by the file path
   * relative to the project root.
   * @example 'https://github.com/acme/skills/blob/main/{path}'
   */
  sourceUrl?: string;
  /** Port of the development server. Default: 4400. */
  port?: number;
}

/** Identity helper that gives editors type information for the config file. */
export function defineConfig(config: SkillariumConfig): SkillariumConfig {
  return config;
}

export class UsageError extends Error {}

const CONFIG_NAMES = ['ts', 'mts', 'js', 'mjs', 'cjs', 'json'].map((ext) => `skillarium.config.${ext}`);

const STRING_FIELDS = ['title', 'description', 'outDir', 'base', 'repository', 'sourceUrl'] as const;
const LIST_FIELDS = ['skills', 'ignore'] as const;
const KNOWN = new Set<string>([...STRING_FIELDS, ...LIST_FIELDS, 'port']);

function validate(value: unknown, file: string): SkillariumConfig {
  const where = path.basename(file);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UsageError(`${where} must export a configuration object as its default export.`);
  }
  const input = value as Record<string, unknown>;
  const config: SkillariumConfig = {};

  for (const key of Object.keys(input)) {
    if (!KNOWN.has(key)) throw new UsageError(`${where}: unknown option "${key}".`);
  }
  for (const key of STRING_FIELDS) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new UsageError(`${where}: "${key}" must be a string.`);
    config[key] = v;
  }
  for (const key of LIST_FIELDS) {
    const v = input[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) {
      throw new UsageError(`${where}: "${key}" must be an array of strings.`);
    }
    config[key] = v as string[];
  }
  if (input.port !== undefined) {
    if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 0 || input.port > 65535) {
      throw new UsageError(`${where}: "port" must be an integer between 0 and 65535.`);
    }
    config.port = input.port;
  }
  return config;
}

export interface LoadedConfig {
  config: SkillariumConfig;
  /** Absolute path of the file that was loaded, if any. */
  file?: string;
}

/**
 * Load the optional configuration file of a project.
 *
 * A TypeScript/JavaScript config file is executed. It is treated as trusted
 * project code (like `vite.config.ts`), unlike skill content, which is never
 * executed.
 */
export async function loadConfig(root: string, explicit?: string): Promise<LoadedConfig> {
  let file: string | undefined;
  if (explicit) {
    file = path.resolve(root, explicit);
    if (!fs.existsSync(file)) throw new UsageError(`Config file not found: ${explicit}`);
  } else {
    file = CONFIG_NAMES.map((name) => path.join(root, name)).find((candidate) => fs.existsSync(candidate));
  }
  if (!file) return { config: {} };

  let loaded: unknown;
  try {
    if (file.endsWith('.json')) {
      loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      // `import { defineConfig } from 'skillarium'` must work even when the
      // package is not installed in the project (e.g. when run through npx).
      const self = fileURLToPath(new URL('./index.js', import.meta.url));
      const alias = fs.existsSync(self) ? { skillarium: self } : { skillarium: fileURLToPath(new URL('./index.ts', import.meta.url)) };
      const jiti = createJiti(file, { alias, moduleCache: false });
      loaded = await jiti.import(file, { default: true });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Could not load ${path.basename(file)}: ${reason}`);
  }
  return { config: validate(loaded, file), file };
}

/** Normalize a base path to the form `/` or `/segment/…/`. */
export function normalizeBase(base: string | undefined): string {
  if (!base || base === '/' || base === './') return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(base) || base.startsWith('//')) {
    throw new UsageError(`Invalid base "${base}": use a path such as /my-repo/, not a full URL.`);
  }
  if (/[\s"'<>?#\\]/.test(base) || base.split('/').includes('..')) {
    throw new UsageError(`Invalid base "${base}": it must be a plain URL path such as /my-repo/.`);
  }
  const trimmed = base.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}
