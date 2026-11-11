import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { buildGraph, linkTargets, mentionsPath, resolveRelative, type GraphDocument } from './graph.js';
import {
  CATALOG_SCHEMA_VERSION,
  type Catalog,
  type ProjectInfo,
  type SkillDefinition,
  type SkillDiagnostic,
  type SkillResource,
  type SkillSource,
} from './model.js';
import { parseSkillFile, validateFrontmatter } from './parse.js';
import { shortHash, slugify, toPosix } from './paths.js';
import {
  classifyFile,
  MAX_FILES_PER_SKILL,
  MAX_SKILL_FILE_BYTES,
  resourceKind,
} from './resources.js';
import {
  collectSkillFiles,
  type CollectedFile,
  DEFAULT_SKILL_ROOTS,
  discoverSkills,
  SKILL_FILE,
  type DiscoveredSkill,
  type ScanContext,
} from './scan.js';

export const IGNORE_FILE = '.skillariumignore';

export interface IndexOptions {
  /** Project root. Relative skill roots and all reported paths are relative to it. */
  root: string;
  /** Skill roots to scan. Defaults to the well-known locations. */
  skills?: string[];
  /** Extra ignore patterns (gitignore syntax), relative to the project root. */
  ignore?: string[];
  project?: Partial<ProjectInfo>;
  mode?: 'dev' | 'static';
  generator?: { name: string; version: string };
}

/** A file whose content the viewer is allowed to fetch. */
export interface PublishedFile {
  absPath: string;
  /** Real path of the skill root; the file must still resolve inside it when served. */
  realRoot: string;
  contentType: string;
}

export interface IndexResult {
  catalog: Catalog;
  /** Allowlist of published files, keyed by URL path relative to the site base. */
  files: Map<string, PublishedFile>;
  /** Absolute paths worth watching for changes. */
  watchPaths: string[];
}

interface Draft {
  discovered: DiscoveredSkill;
  sourceId: string;
  sourcePath: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  content: string;
  diagnostics: SkillDiagnostic[];
  /** SKILL.md as read from disk; empty when it could not be loaded. */
  raw: string;
  /** False when SKILL.md could not be read at all. */
  loaded: boolean;
  /** True when `name` comes from the frontmatter, not from the directory. */
  declaredName: boolean;
}

async function readIgnoreFile(root: string): Promise<string> {
  try {
    return await fs.readFile(path.join(root, IGNORE_FILE), 'utf8');
  } catch {
    return '';
  }
}

async function readSkillFile(dir: string): Promise<{ raw: string; error?: SkillDiagnostic }> {
  const file = path.join(dir, SKILL_FILE);
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_SKILL_FILE_BYTES) {
      return {
        raw: '',
        error: {
          severity: 'error',
          code: 'skill-file-too-large',
          message: `SKILL.md is larger than ${MAX_SKILL_FILE_BYTES / 1024} KB and was not loaded.`,
          file: SKILL_FILE,
        },
      };
    }
    return { raw: await fs.readFile(file, 'utf8') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    return {
      raw: '',
      error: {
        severity: 'error',
        code: 'unreadable-skill-file',
        message: `SKILL.md could not be read (${code}).`,
        file: SKILL_FILE,
      },
    };
  }
}

/** Assign unique, deterministic, URL-safe ids. */
function assignIds(drafts: Draft[]): string[] {
  const byName = new Map<string, number>();
  for (const draft of drafts) {
    const slug = slugify(draft.name);
    byName.set(slug, (byName.get(slug) ?? 0) + 1);
  }
  const used = new Set<string>();
  return drafts.map((draft) => {
    const slug = slugify(draft.name);
    // A unique name gets the short id; clashing names fall back to their path.
    let id = byName.get(slug) === 1 ? slug : slugify(draft.sourcePath);
    if (used.has(id)) id = `${id}-${shortHash(draft.sourcePath)}`;
    used.add(id);
    return id;
  });
}

/** Discovery and file collection may report the same entry; keep one. */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Markdown with fenced blocks and inline code removed: links inside code are examples. */
function withoutCode(markdown: string): string {
  return markdown.replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** The directory of a document inside its skill ('' for the skill root). */
function docDirOf(docPath: string): string {
  return docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
}

/**
 * The folders a path written in `docPath` may be meant from: the document's
 * own, then each folder above it, up to the skill root (''). A skill made of
 * self-contained parts writes its paths from the part's folder.
 */
function basesOf(docPath: string): string[] {
  const bases: string[] = [];
  let dir = docDirOf(docPath);
  while (dir !== '') {
    bases.push(dir);
    dir = docDirOf(dir);
  }
  bases.push('');
  return bases;
}

/** A link target written like a file or folder: it has a `/` or ends in an extension. */
function looksLikePath(target: string): boolean {
  return target.includes('/') || /\.[A-Za-z0-9]+$/.test(target);
}

/**
 * Whether one of `candidates` (paths relative to the skill) exists: as an
 * indexed file, or as anything else inside the project (a folder, an ignored
 * or unpublished file). A path that leaves the project is not looked at —
 * nothing outside the project root ever is — and yields 'unknown'.
 */
async function lookUp(
  projectRoot: string,
  skill: SkillDefinition,
  known: Set<string>,
  candidates: string[],
): Promise<'found' | 'missing' | 'unknown'> {
  if (candidates.some((candidate) => known.has(candidate))) return 'found';
  let checked = false;
  for (const candidate of candidates) {
    const projectPath = resolveRelative(skill.sourcePath, candidate);
    if (projectPath.startsWith('../')) continue;
    checked = true;
    if (await exists(path.join(projectRoot, ...projectPath.split('/')))) return 'found';
  }
  return checked ? 'missing' : 'unknown';
}

/**
 * A script or reference named as a standalone token: `scripts/run.py`. Paths
 * under `assets/` are left out: they are most often outputs or project files.
 */
const NAMED_PATH = /(?<![\w./#-])(?:\.\/)?((?:scripts|references)\/[\w.\-/]*[\w-]\.[A-Za-z0-9]+)(?![\w/-])/g;

/**
 * Report, for every Markdown document of every skill:
 *
 * - `broken-link` (error): a relative Markdown link or image that leads to no
 *   file. Links with a scheme, anchors, absolute paths and links inside code
 *   are not checked.
 * - `missing-path` (warning): a file under `scripts/` or `references/` that
 *   is named, in text or in code, but does not exist. Naming a path is not
 *   always a claim that the file is there, hence only a warning.
 */
async function reportMissingTargets(
  projectRoot: string,
  skills: SkillDefinition[],
  documents: GraphDocument[],
): Promise<void> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  /** Which skills have a file at a given path, to recognise a path meant for another skill. */
  const owners = new Map<string, Set<string>>();
  for (const skill of skills) {
    for (const resource of skill.resources) {
      owners.set(resource.path, (owners.get(resource.path) ?? new Set()).add(skill.id));
    }
  }
  for (const doc of documents) {
    const skill = byId.get(doc.skillId);
    if (!skill) continue;
    const known = new Set([SKILL_FILE, '', ...skill.resources.map((r) => r.path)]);
    const bases = basesOf(doc.path);
    const reported = new Set<string>();
    /** Paths (relative to the skill) that a broken link of this document stands for. */
    const brokenPaths = new Set<string>();

    for (const target of linkTargets(withoutCode(doc.text))) {
      if (target.startsWith('/') || reported.has(target)) continue;
      // A placeholder such as `[Source](URL)` is not a path: nothing to judge.
      if (!looksLikePath(target)) continue;
      // Relative to the document, to a folder above it, or to the skill root.
      const candidates = bases.map((base) => resolveRelative(base, target));
      if ((await lookUp(projectRoot, skill, known, candidates)) !== 'missing') continue;

      reported.add(target);
      for (const candidate of candidates) brokenPaths.add(candidate);
      skill.diagnostics.push({
        severity: 'error',
        code: 'broken-link',
        message: `${doc.path} links to \`${target}\`, which does not exist.`,
        file: doc.path,
      });
    }

    const named = new Set<string>();
    for (const match of doc.text.matchAll(NAMED_PATH)) {
      const target = match[1]!;
      if (named.has(target)) continue;
      named.add(target);
      // Named from the skill root, as the specification writes paths, or from a folder of the document.
      const candidates = bases.map((base) => resolveRelative(base, target));
      if (candidates.some((candidate) => brokenPaths.has(candidate))) continue; // already a broken link
      if (owners.has(target)) continue; // a file of another skill, named from its own root
      if ((await lookUp(projectRoot, skill, known, candidates)) !== 'missing') continue;
      skill.diagnostics.push({
        severity: 'warning',
        code: 'missing-path',
        message: `${doc.path} names \`${target}\`, which does not exist.`,
        file: doc.path,
      });
    }
  }
}

/** Files that belong in a skill folder without being part of its instructions. */
const NEVER_ORPHAN = /^((licen[sc]e|notice|readme|changelog)(\.[^/]*)?|__init__\.py|.+\.(test|spec)\.[^.]+|test_.+\.py|.+_test\.py)$/i;
/** Directly inside one of the specification's folders: written for the agent to use. */
const TOP_OF_SPEC_FOLDER = /^(scripts|references|assets)\/[^/]+$/;
/** Source files that other scripts name without their extension (`import helpers`). */
const MODULE = /\.(py|js|mjs|cjs|ts|mts|rb|sh)$/i;
const MAX_ORPHANS_LISTED = 10;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `text` names the file `name` on its own (`template.json`, `../assets/template.json`). */
function mentionsFileName(text: string, name: string): boolean {
  if (name.length < 3 || !name.includes('.') || !text.includes(name)) return false;
  return new RegExp(`(?<![\\w.-])${escapeRegExp(name)}(?![\\w-])`).test(text);
}

/** True when a script names the module `stem` (`import helpers`, `require('./helpers')`). */
function mentionsModule(text: string, stem: string): boolean {
  if (stem.length < 3 || !text.includes(stem)) return false;
  return new RegExp(`(?<![\\w.-])${escapeRegExp(stem)}(?![\\w-])`).test(text);
}

/**
 * Add an `orphan-file` warning for the files of a skill that cannot be
 * reached from SKILL.md. An agent starts from SKILL.md and follows what it
 * says, so a file that nothing reached refers to is never found.
 *
 * Only what an author writes for the agent is judged: Markdown documents, and
 * the files directly inside `scripts/`, `references/` and `assets/`. Deeper
 * data, schemas and helper modules are plumbing that scripts load their own
 * way.
 *
 * A file is reached when a reached document or script links to it, names its
 * path, or names its file name. The rule leans towards not reporting: a wrong
 * warning is worse than a missed one.
 */
async function reportOrphans(
  skill: SkillDefinition,
  documents: GraphDocument[],
  files: Map<string, CollectedFile>,
): Promise<void> {
  const candidates = skill.resources.filter(
    (r) =>
      (r.preview === 'markdown' || TOP_OF_SPEC_FOLDER.test(r.path)) &&
      !NEVER_ORPHAN.test(r.path.slice(r.path.lastIndexOf('/') + 1)),
  );
  if (candidates.length === 0) return;

  const markdown = new Map(documents.map((doc) => [doc.path, doc.text]));
  const byPath = new Map(skill.resources.map((r) => [r.path, r]));
  const textOf = async (filePath: string): Promise<string | null> => {
    const known = markdown.get(filePath);
    if (known !== undefined) return known;
    const resource = byPath.get(filePath);
    const file = files.get(filePath);
    // Only text that is published is read: the same files the viewer shows.
    if (!resource?.url || resource.preview !== 'text' || !file) return null;
    try {
      return await fs.readFile(file.abs, 'utf8');
    } catch {
      return null;
    }
  };

  // Every folder that holds a file of the skill, to notice a folder that is named.
  const folders = new Set<string>();
  for (const resource of skill.resources) {
    for (let dir = docDirOf(resource.path); dir !== ''; dir = docDirOf(dir)) folders.add(dir);
  }
  const namesFolder = (text: string, folder: string) =>
    text.includes(`${folder}/`) && new RegExp(`(?<![\\w./#-])(?:\\./)?${escapeRegExp(folder)}/(?![\\w.])`).test(text);

  const reached = new Set<string>([SKILL_FILE]);
  const queue = [SKILL_FILE];
  while (queue.length > 0 && reached.size <= skill.resources.length) {
    const current = queue.shift()!;
    const text = await textOf(current);
    if (text === null) continue;
    const linked = new Set<string>();
    if (markdown.has(current)) {
      for (const target of linkTargets(text)) {
        for (const base of basesOf(current)) linked.add(resolveRelative(base, target));
      }
    }
    // A folder that is linked to or named reaches everything in it: an agent sent there lists it.
    const opened = [...folders].filter((folder) => linked.has(folder) || namesFolder(text, folder));
    for (const resource of skill.resources) {
      if (reached.has(resource.path)) continue;
      const name = resource.path.slice(resource.path.lastIndexOf('/') + 1);
      if (
        linked.has(resource.path) ||
        opened.some((folder) => resource.path.startsWith(`${folder}/`)) ||
        mentionsPath(text, resource.path) ||
        mentionsFileName(text, name) ||
        (!markdown.has(current) && MODULE.test(name) && mentionsModule(text, name.slice(0, name.lastIndexOf('.'))))
      ) {
        reached.add(resource.path);
        queue.push(resource.path);
      }
    }
  }

  const orphans = candidates.filter((r) => !reached.has(r.path));
  for (const orphan of orphans.slice(0, MAX_ORPHANS_LISTED)) {
    skill.diagnostics.push({
      severity: 'warning',
      code: 'orphan-file',
      message: `\`${orphan.path}\` is never referenced from SKILL.md or the files it leads to, so an agent will not find it.`,
      file: orphan.path,
    });
  }
  const rest = orphans.length - MAX_ORPHANS_LISTED;
  if (rest > 0) {
    skill.diagnostics.push({
      severity: 'warning',
      code: 'orphan-file',
      message: rest === 1 ? '1 more file is never referenced.' : `${rest} more files are never referenced.`,
    });
  }
}

/** Above this size a file is compared by its size alone. */
const MAX_COMPARED_BYTES = 8 * 1024 * 1024;

/** A digest of everything a skill consists of: SKILL.md and each file with its content. */
async function fingerprint(raw: string, files: CollectedFile[]): Promise<string> {
  const hash = createHash('sha256').update(raw);
  for (const file of files) {
    hash.update(`\0${file.rel}\0`);
    if (file.size > MAX_COMPARED_BYTES) {
      hash.update(`size:${file.size}`);
      continue;
    }
    try {
      hash.update(createHash('sha256').update(await fs.readFile(file.abs)).digest());
    } catch {
      hash.update(`unreadable:${file.rel}`);
    }
  }
  return hash.digest('hex');
}

/**
 * Add a `duplicate-name` error to skills that share a declared `name` with a
 * skill they are not a copy of. Identical copies (the same skill kept in
 * several agent folders) are fine; copies that drifted apart are not.
 */
async function reportDuplicateNames(
  entries: { skill: SkillDefinition; draft: Draft; files: CollectedFile[] }[],
): Promise<void> {
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.draft.declaredName) continue;
    groups.set(entry.skill.name, [...(groups.get(entry.skill.name) ?? []), entry]);
  }
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    const prints = await Promise.all(group.map((entry) => fingerprint(entry.draft.raw, entry.files)));
    group.forEach((entry, index) => {
      const others = group
        .filter((_other, other) => prints[other] !== prints[index])
        .map((other) => other.skill.sourcePath)
        .sort();
      if (others.length === 0) return;
      entry.skill.diagnostics.push({
        severity: 'error',
        code: 'duplicate-name',
        message: `The name "${name}" is also used by ${others.map((p) => `\`${p}\``).join(', ')}, with different content.`,
        file: SKILL_FILE,
      });
    });
  }
}

function dedupe(diagnostics: SkillDiagnostic[]): SkillDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((d) => {
    const key = `${d.code}\0${d.file ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function encodeUrlPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/** Discover, parse and index every skill of a project. Never executes anything. */
export async function indexProject(options: IndexOptions): Promise<IndexResult> {
  const projectRoot = path.resolve(options.root);
  const explicit = options.skills !== undefined && options.skills.length > 0;
  const rootSpecs = explicit ? options.skills! : DEFAULT_SKILL_ROOTS;

  const diagnostics: SkillDiagnostic[] = [];
  const ctx: ScanContext = {
    projectRoot,
    ignore: ignore().add(options.ignore ?? []).add(await readIgnoreFile(projectRoot)),
    diagnostics,
  };

  const sources: SkillSource[] = [];
  const searched: string[] = [];
  const watchPaths: string[] = [];
  const drafts: Draft[] = [];
  const seenRealDirs = new Set<string>();
  const seenSourceIds = new Set<string>();

  for (const spec of rootSpecs) {
    const abs = path.resolve(projectRoot, spec);
    const rel = toPosix(path.relative(projectRoot, abs)) || '.';
    if (searched.includes(rel)) continue;
    searched.push(rel);

    const exists = await fs.stat(abs).then((s) => s.isDirectory(), () => false);
    if (!exists) {
      if (explicit) {
        diagnostics.push({
          severity: 'warning',
          code: 'root-not-found',
          message: 'Configured skill root does not exist.',
          file: rel,
        });
      }
      continue;
    }
    watchPaths.push(abs);

    const discovered = await discoverSkills(ctx, abs);
    let sourceId = slugify(rel === '.' ? 'project' : rel);
    if (seenSourceIds.has(sourceId)) sourceId = `${sourceId}-${shortHash(rel)}`;
    let added = 0;

    for (const skill of discovered) {
      if (seenRealDirs.has(skill.realDir)) continue; // overlapping roots or symlinks
      seenRealDirs.add(skill.realDir);
      added++;

      const directoryName = path.basename(skill.dir);
      const { raw, error } = await readSkillFile(skill.dir);
      const parsed = parseSkillFile(raw);
      const skillDiagnostics = error
        ? [error]
        : [
            ...parsed.diagnostics,
            ...(parsed.diagnostics.length === 0
              ? validateFrontmatter(parsed.frontmatter, directoryName)
              : []),
          ];
      const { name, description } = parsed.frontmatter;

      drafts.push({
        discovered: skill,
        sourceId,
        sourcePath: toPosix(path.relative(projectRoot, skill.dir)) || '.',
        name: typeof name === 'string' && name.trim() ? name.trim() : directoryName,
        description: typeof description === 'string' ? description.trim() : '',
        metadata: parsed.frontmatter,
        content: error ? '' : parsed.body,
        diagnostics: skillDiagnostics,
        raw: error ? '' : raw,
        loaded: !error,
        declaredName: typeof name === 'string' && name.trim() !== '',
      });
    }

    if (added > 0) {
      seenSourceIds.add(sourceId);
      sources.push({ id: sourceId, path: rel });
    }
  }

  const sourceOrder = new Map(sources.map((s, i) => [s.id, i]));
  drafts.sort(
    (a, b) =>
      sourceOrder.get(a.sourceId)! - sourceOrder.get(b.sourceId)! ||
      a.name.localeCompare(b.name, 'en') ||
      (a.sourcePath < b.sourcePath ? -1 : 1),
  );
  const ids = assignIds(drafts);

  const files = new Map<string, PublishedFile>();
  const documents: GraphDocument[] = [];
  const skills: SkillDefinition[] = [];
  const collectedFiles: CollectedFile[][] = [];

  for (const [index, draft] of drafts.entries()) {
    const id = ids[index]!;
    const collected = await collectSkillFiles(ctx, draft.discovered, MAX_FILES_PER_SKILL);
    collectedFiles.push(collected.files);
    const resources: SkillResource[] = [];

    for (const file of collected.files) {
      const cls = await classifyFile(file.rel, file.abs, file.size);
      const resource: SkillResource = {
        path: file.rel,
        kind: resourceKind(file.rel),
        size: file.size,
        preview: cls.preview,
      };
      if (cls.language) resource.language = cls.language;
      if (cls.omitted) resource.omitted = cls.omitted;
      if (cls.contentType) {
        // Text is always published with a `.txt` suffix so that no static host
        // will ever serve skill content as HTML, SVG or script.
        const suffix = cls.preview === 'image' ? '' : '.txt';
        resource.url = `files/${id}/${encodeUrlPath(file.rel)}${suffix}`;
        files.set(`files/${id}/${file.rel}${suffix}`, {
          absPath: file.abs,
          realRoot: draft.discovered.realRoot,
          contentType: cls.contentType,
        });
        if (cls.preview === 'markdown') {
          try {
            documents.push({
              skillId: id,
              path: file.rel,
              text: await fs.readFile(file.abs, 'utf8'),
            });
          } catch {
            // unreadable: no references can be extracted
          }
        }
      }
      resources.push(resource);
    }

    documents.push({ skillId: id, path: SKILL_FILE, text: draft.content });
    skills.push({
      id,
      name: draft.name,
      description: draft.description,
      sourceId: draft.sourceId,
      sourcePath: draft.sourcePath,
      metadata: draft.metadata,
      content: draft.content,
      resources,
      diagnostics: [...draft.diagnostics, ...collected.diagnostics],
    });
  }

  await reportMissingTargets(projectRoot, skills, documents);
  await reportDuplicateNames(
    skills.map((skill, index) => ({ skill, draft: drafts[index]!, files: collectedFiles[index]! })),
  );
  for (const [index, skill] of skills.entries()) {
    if (!drafts[index]!.loaded) continue; // nothing to start from
    await reportOrphans(
      skill,
      documents.filter((doc) => doc.skillId === skill.id),
      new Map(collectedFiles[index]!.map((file) => [file.rel, file])),
    );
  }

  const project: ProjectInfo = {
    title: options.project?.title?.trim() || path.basename(projectRoot) || 'Agent Skills',
  };
  if (options.project?.description) project.description = options.project.description;
  if (options.project?.repository) project.repository = options.project.repository;
  if (options.project?.sourceUrl) project.sourceUrl = options.project.sourceUrl;

  const catalog: Catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generator: options.generator ?? { name: 'skillarium', version: '0.0.0' },
    mode: options.mode ?? 'static',
    project,
    searched,
    sources,
    skills,
    graph: buildGraph(skills, documents),
    diagnostics: dedupe(diagnostics),
  };

  return { catalog, files, watchPaths };
}
