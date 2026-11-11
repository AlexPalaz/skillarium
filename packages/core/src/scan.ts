import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ignore } from 'ignore';
import type { SkillDiagnostic } from './model.js';
import { isInside, toPosix } from './paths.js';

export const SKILL_FILE = 'SKILL.md';

/** Locations searched when no explicit roots are configured. */
export const DEFAULT_SKILL_ROOTS = [
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
  '.gemini/skills',
  '.github/skills',
  '.opencode/skills',
  'skills',
];

const MAX_DEPTH = 8;
const ALWAYS_SKIPPED = new Set(['node_modules']);

/** File names that commonly hold credentials; never indexed or published. */
const SECRET_FILE = /(\.(pem|key|p12|pfx|jks|keystore)$)|(^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$)/i;

export interface ScanContext {
  projectRoot: string;
  /** Matcher for user ignore patterns, tested against project-relative paths. */
  ignore: Ignore;
  diagnostics: SkillDiagnostic[];
}

export interface DiscoveredSkill {
  /** Absolute path as walked (symlinks not resolved). */
  dir: string;
  /** Resolved real path; used for de-duplication. */
  realDir: string;
  /** Real path of the root the skill was found in; the containment boundary. */
  realRoot: string;
}

export interface CollectedFile {
  /** POSIX path relative to the skill directory. */
  rel: string;
  abs: string;
  size: number;
}

function projectRelative(ctx: ScanContext, abs: string): string {
  return toPosix(path.relative(ctx.projectRoot, abs)) || '.';
}

function isIgnored(ctx: ScanContext, abs: string, isDir: boolean): boolean {
  const rel = toPosix(path.relative(ctx.projectRoot, abs));
  // The `ignore` package only accepts paths inside the project.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return ctx.ignore.ignores(isDir ? `${rel}/` : rel);
}

function skippedByName(name: string): boolean {
  return name.startsWith('.') || ALWAYS_SKIPPED.has(name);
}

type Entry = { name: string; abs: string; real: string; isDir: boolean; size: number };

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | undefined)?.code ?? 'unknown error';
}

/**
 * List a directory, resolving symlinks and dropping everything that is
 * ignored, hidden, unreadable, or resolves outside `realRoot`.
 */
async function listDir(ctx: ScanContext, dir: string, realRoot: string): Promise<Entry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'unreadable-directory',
      message: `Cannot read directory (${errorCode(error)}).`,
      file: projectRelative(ctx, dir),
    });
    return [];
  }
  names.sort();

  const entries: Entry[] = [];
  for (const name of names) {
    if (skippedByName(name)) continue;
    const abs = path.join(dir, name);
    try {
      const lst = await fs.lstat(abs);
      let real = abs;
      let stat = lst;
      if (lst.isSymbolicLink()) {
        real = await fs.realpath(abs);
        if (!isInside(realRoot, real)) {
          ctx.diagnostics.push({
            severity: 'warning',
            code: 'symlink-escape',
            message: 'Symbolic link points outside its skill root and was skipped.',
            file: projectRelative(ctx, abs),
          });
          continue;
        }
        stat = await fs.stat(abs);
      }
      const isDir = stat.isDirectory();
      if (!isDir && !stat.isFile()) continue; // sockets, FIFOs, devices
      if (isIgnored(ctx, abs, isDir)) continue;
      entries.push({ name, abs, real, isDir, size: stat.size });
    } catch (error) {
      ctx.diagnostics.push({
        severity: 'warning',
        code: 'unreadable-entry',
        message: `Cannot access entry (${errorCode(error)}).`,
        file: projectRelative(ctx, abs),
      });
    }
  }
  return entries;
}

/**
 * Find every directory under `root` that contains a SKILL.md. Skills may be
 * nested inside grouping folders or inside other skills.
 */
export async function discoverSkills(ctx: ScanContext, root: string): Promise<DiscoveredSkill[]> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
    if (!(await fs.stat(realRoot)).isDirectory()) return [];
  } catch {
    return [];
  }

  const found: DiscoveredSkill[] = [];
  const visited = new Set<string>();

  async function walk(dir: string, realDir: string, depth: number): Promise<void> {
    if (visited.has(realDir) || depth > MAX_DEPTH) return;
    visited.add(realDir);
    const entries = await listDir(ctx, dir, realRoot);
    if (entries.some((e) => !e.isDir && e.name === SKILL_FILE)) {
      found.push({ dir, realDir, realRoot });
    }
    for (const entry of entries) {
      if (entry.isDir) await walk(entry.abs, entry.real, depth + 1);
    }
  }

  await walk(root, realRoot, 0);
  return found;
}

/**
 * Collect the supporting files of one skill. Nested skills are excluded: they
 * are indexed as skills of their own.
 */
export async function collectSkillFiles(
  ctx: ScanContext,
  skill: DiscoveredSkill,
  maxFiles: number,
): Promise<{ files: CollectedFile[]; diagnostics: SkillDiagnostic[] }> {
  const files: CollectedFile[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const visited = new Set<string>([skill.realDir]);
  let truncated = false;
  let secrets = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || truncated) return;
    const entries = await listDir(ctx, dir, skill.realRoot);
    if (depth > 0 && entries.some((e) => !e.isDir && e.name === SKILL_FILE)) return;
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDir) {
        if (visited.has(entry.real)) continue;
        visited.add(entry.real);
        await walk(entry.abs, depth + 1);
      } else {
        if (depth === 0 && entry.name === SKILL_FILE) continue;
        if (SECRET_FILE.test(entry.name)) {
          secrets++;
          continue;
        }
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        files.push({
          rel: toPosix(path.relative(skill.dir, entry.abs)),
          abs: entry.abs,
          size: entry.size,
        });
      }
    }
  }

  await walk(skill.dir, 0);

  if (truncated) {
    diagnostics.push({
      severity: 'warning',
      code: 'too-many-files',
      message: `Only the first ${maxFiles} files of this skill were indexed.`,
    });
  }
  if (secrets > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'secret-files-excluded',
      message: `${secrets} file(s) that look like keys or credentials were excluded.`,
    });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files, diagnostics };
}
