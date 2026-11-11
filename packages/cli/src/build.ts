import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside, type Catalog } from '@skillarium/core';
import { normalizeBase, UsageError } from './config.js';
import { indexWith, type Project } from './project.js';
import { renderShell, VERSION, webDir } from './shell.js';

export const DEFAULT_OUT_DIR = 'skillarium-dist';
/** Written into every build; marks a directory as safe for Skillarium to replace. */
export const BUILD_MARKER = 'skillarium-build.json';

export interface BuildOptions {
  project: Project;
  outDir?: string;
  base?: string;
}

export interface BuildResult {
  outDir: string;
  base: string;
  catalog: Catalog;
  pages: number;
  files: number;
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

/** Empty the output directory, but only if it is plausibly ours to empty. */
async function prepareOutDir(outDir: string, root: string): Promise<void> {
  if (isInside(outDir, root)) {
    throw new UsageError(`Refusing to build into ${outDir}: it contains the project itself.`);
  }
  if (await exists(outDir)) {
    const stat = await fs.stat(outDir);
    if (!stat.isDirectory()) throw new UsageError(`Output path is not a directory: ${outDir}`);
    const entries = await fs.readdir(outDir);
    if (entries.length > 0 && !entries.includes(BUILD_MARKER)) {
      throw new UsageError(
        `Output directory ${outDir} is not empty and was not created by Skillarium. Delete it or choose another with --out-dir.`,
      );
    }
    await fs.rm(outDir, { recursive: true, force: true });
  }
  await fs.mkdir(outDir, { recursive: true });
}

/**
 * Generate a self-contained static site.
 *
 * Every route gets a real `index.html`, so direct navigation and refresh work
 * on any static host without rewrite rules or a single-page-app fallback.
 * Only the viewer, the catalog and the files the indexer published are
 * written; nothing else from the project is copied.
 */
export async function buildSite(options: BuildOptions): Promise<BuildResult> {
  const { project } = options;
  const base = normalizeBase(options.base ?? project.config.base);
  const outDir = path.resolve(project.root, options.outDir ?? project.config.outDir ?? DEFAULT_OUT_DIR);
  const assets = webDir();

  const { catalog, files } = await indexWith(project, 'static');
  await prepareOutDir(outDir, project.root);

  // 1. Viewer assets (everything except the shell template).
  for (const entry of await fs.readdir(assets)) {
    if (entry === 'index.html') continue;
    await fs.cp(path.join(assets, entry), path.join(outDir, entry), { recursive: true });
  }

  // 2. One HTML page per route.
  const template = await fs.readFile(path.join(assets, 'index.html'), 'utf8');
  const { title, description } = catalog.project;
  const pages: { file: string; title: string; description?: string }[] = [
    { file: 'index.html', title: `${title} · Skillarium`, description },
    { file: '404.html', title: `Not found · ${title}` },
    { file: 'skills/index.html', title: `Skills · ${title}`, description },
    { file: 'architecture/index.html', title: `Architecture · ${title}`, description },
    ...catalog.skills.map((skill) => ({
      file: `skills/${skill.id}/index.html`,
      title: `${skill.name} · ${title}`,
      description: skill.description || undefined,
    })),
  ];
  for (const page of pages) {
    const target = path.join(outDir, page.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, renderShell(template, { base, title: page.title, description: page.description }));
  }

  // 3. Data.
  await fs.mkdir(path.join(outDir, 'data'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'data', 'catalog.json'), JSON.stringify(catalog));

  // 4. Published skill files, re-checked against their root at copy time.
  let copied = 0;
  for (const [urlPath, file] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const target = path.resolve(outDir, urlPath);
    if (!isInside(outDir, target)) continue;
    try {
      if (!isInside(file.realRoot, await fs.realpath(file.absPath))) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.absPath, target);
      copied++;
    } catch {
      // The file disappeared since indexing; the viewer reports it as unavailable.
    }
  }

  // 5. Host hints and the ownership marker.
  await fs.writeFile(path.join(outDir, '.nojekyll'), '');
  await fs.writeFile(
    path.join(outDir, BUILD_MARKER),
    `${JSON.stringify({ generator: 'skillarium', version: VERSION, base }, null, 2)}\n`,
  );

  return { outDir, base, catalog, pages: pages.length, files: copied };
}

/** Read the base path a site was built with, if `dir` is a Skillarium build. */
export async function readBuildBase(dir: string): Promise<string | undefined> {
  try {
    const marker = JSON.parse(await fs.readFile(path.join(dir, BUILD_MARKER), 'utf8')) as { base?: unknown };
    return typeof marker.base === 'string' ? marker.base : undefined;
  } catch {
    return undefined;
  }
}
