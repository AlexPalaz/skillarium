import type { Catalog, SkillDefinition, SkillResource } from '@skillarium/core/model';

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Resolve `target` against `baseDir` (POSIX). May return a path starting with `../`. */
export function resolveRelative(baseDir: string, target: string): string {
  const out: string[] = [];
  let up = 0;
  for (const segment of `${baseDir}/${target}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0) out.pop();
      else up++;
    } else {
      out.push(segment);
    }
  }
  return '../'.repeat(up) + out.join('/');
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export type ResolvedLink =
  | { type: 'anchor'; href: string }
  | { type: 'external'; href: string }
  /** `file` is undefined for the skill's SKILL.md. */
  | { type: 'internal'; skillId: string; file?: string; resource?: SkillResource }
  | { type: 'unresolved' };

/**
 * Decide where a link or image target found in a skill document leads.
 * Only http(s) and mailto are treated as external; every other scheme is
 * unresolved and rendered as plain text.
 */
export function resolveLink(
  href: string | undefined,
  skill: SkillDefinition,
  docPath: string,
  catalog: Catalog,
): ResolvedLink {
  if (!href) return { type: 'unresolved' };
  if (href.startsWith('#')) return { type: 'anchor', href };
  if (/^(https?:\/\/|mailto:)/i.test(href)) return { type: 'external', href };
  if (HAS_SCHEME.test(href) || href.startsWith('//')) return { type: 'unresolved' };

  let target = href.replace(/[#?].*$/, '');
  try {
    target = decodeURI(target);
  } catch {
    // keep as written
  }
  if (!target) return { type: 'unresolved' };

  const inSkill = (candidate: SkillDefinition, path: string): ResolvedLink | null => {
    if (path === 'SKILL.md' || path === '') return { type: 'internal', skillId: candidate.id };
    const resource = candidate.resources.find((r) => r.path === path);
    return resource ? { type: 'internal', skillId: candidate.id, file: path, resource } : null;
  };

  // Relative to the document first, then to the skill root (the spec's convention).
  for (const candidate of [resolveRelative(dirname(docPath), target), resolveRelative('', target)]) {
    if (candidate.startsWith('../')) continue;
    const found = inSkill(skill, candidate);
    if (found) return found;
  }

  // A link that leaves this skill may point into another indexed skill.
  const projectPath = resolveRelative(skill.sourcePath, `${dirname(docPath)}/${target}`);
  let other: SkillDefinition | undefined;
  for (const candidate of catalog.skills) {
    if (projectPath === candidate.sourcePath || projectPath.startsWith(`${candidate.sourcePath}/`)) {
      if (!other || candidate.sourcePath.length > other.sourcePath.length) other = candidate;
    }
  }
  if (other) {
    const found = inSkill(other, projectPath.slice(other.sourcePath.length + 1));
    if (found) return found;
  }
  return { type: 'unresolved' };
}

export function sourceLink(catalog: Catalog, projectPath: string): string | undefined {
  const template = catalog.project.sourceUrl;
  if (!template || !/^https?:\/\//i.test(template)) return undefined;
  return template.replace('{path}', projectPath.split('/').map(encodeURIComponent).join('/'));
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
