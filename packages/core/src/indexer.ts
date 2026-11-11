import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { buildGraph, type GraphDocument } from './graph.js';
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

  for (const [index, draft] of drafts.entries()) {
    const id = ids[index]!;
    const collected = await collectSkillFiles(ctx, draft.discovered, MAX_FILES_PER_SKILL);
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
