import fs from 'node:fs';
import path from 'node:path';
import { indexProject, type IndexResult } from '@skillarium/core';
import { loadConfig, normalizeBase, UsageError, type SkillariumConfig } from './config.js';
import { GENERATOR } from './shell.js';

export interface ProjectOptions {
  root?: string;
  config?: string;
}

export interface Project {
  root: string;
  config: SkillariumConfig;
  configFile?: string;
}

export async function openProject(options: ProjectOptions): Promise<Project> {
  const root = path.resolve(options.root ?? '.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new UsageError(`Project root is not a directory: ${options.root ?? root}`);
  }
  const { config, file } = await loadConfig(root, options.config);
  normalizeBase(config.base); // fail early on an invalid base
  return { root, config, configFile: file };
}

export function indexWith(project: Project, mode: 'dev' | 'static'): Promise<IndexResult> {
  const { config } = project;
  return indexProject({
    root: project.root,
    skills: config.skills,
    ignore: config.ignore,
    mode,
    generator: GENERATOR,
    project: {
      title: config.title,
      description: config.description,
      repository: config.repository,
      sourceUrl: config.sourceUrl,
    },
  });
}
