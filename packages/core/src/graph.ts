import type { GraphEdge, GraphNode, SkillDefinition, SkillGraph } from './model.js';

/** A Markdown document whose text is searched for explicit file references. */
export interface GraphDocument {
  skillId: string;
  /** `SKILL.md` or a resource path relative to the skill directory. */
  path: string;
  text: string;
}

export const skillNodeId = (skillId: string) => `skill:${skillId}`;
export const fileNodeId = (skillId: string, path: string) => `file:${skillId}:${path}`;

const MARKDOWN_LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
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

/** Relative targets of the Markdown links and images in `text`, without fragment or query. */
export function linkTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    let target = match[1] ?? '';
    if (HAS_SCHEME.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    target = target.replace(/[#?].*$/, '');
    try {
      target = decodeURI(target);
    } catch {
      // keep the raw target
    }
    if (target) targets.push(target);
  }
  return targets;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `text` names `resourcePath` as a standalone path token. */
function mentionsPath(text: string, resourcePath: string): boolean {
  if (resourcePath.length < 3 || !/[./]/.test(resourcePath)) return false;
  if (!text.includes(resourcePath)) return false;
  const pattern = new RegExp(`(?<![\\w./#-])(?:\\./)?${escapeRegExp(resourcePath)}(?![\\w/-])`);
  return pattern.test(text);
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Build the architecture graph. Every edge is grounded in either the
 * filesystem (`contains`) or an explicit path/link found in a document
 * (`references`, `links-to-skill`). No relationship is inferred.
 */
export function buildGraph(skills: SkillDefinition[], documents: GraphDocument[]): SkillGraph {
  const nodes: GraphNode[] = [];
  const edges = new Map<string, GraphEdge>();
  const addEdge = (edge: Omit<GraphEdge, 'id'>) => {
    const id = `${edge.kind}:${edge.source}->${edge.target}`;
    if (!edges.has(id)) edges.set(id, { id, ...edge });
  };

  const byId = new Map(skills.map((skill) => [skill.id, skill]));

  for (const skill of skills) {
    nodes.push({ id: skillNodeId(skill.id), type: 'skill', label: skill.name, skillId: skill.id });
    for (const resource of skill.resources) {
      const id = fileNodeId(skill.id, resource.path);
      nodes.push({
        id,
        type: resource.kind,
        label: resource.path.slice(resource.path.lastIndexOf('/') + 1),
        skillId: skill.id,
        path: resource.path,
      });
      addEdge({
        source: skillNodeId(skill.id),
        target: id,
        kind: 'contains',
        evidence: `${resource.path} is inside the skill directory`,
      });
    }
  }

  const findSkillByProjectPath = (projectPath: string): SkillDefinition | undefined => {
    let best: SkillDefinition | undefined;
    for (const skill of skills) {
      if (projectPath === skill.sourcePath || projectPath.startsWith(`${skill.sourcePath}/`)) {
        if (!best || skill.sourcePath.length > best.sourcePath.length) best = skill;
      }
    }
    return best;
  };

  for (const doc of documents) {
    const skill = byId.get(doc.skillId);
    if (!skill) continue;
    const resourcePaths = new Set(skill.resources.map((r) => r.path));
    const source =
      doc.path === 'SKILL.md' ? skillNodeId(skill.id) : fileNodeId(skill.id, doc.path);
    const linked = new Set<string>();

    for (const target of linkTargets(doc.text)) {
      const fromDoc = resolveRelative(dirname(doc.path), target);
      const fromRoot = resolveRelative('', target);
      const local = [fromDoc, fromRoot].find((p) => resourcePaths.has(p));
      if (local) {
        if (local !== doc.path) {
          linked.add(local);
          addEdge({
            source,
            target: fileNodeId(skill.id, local),
            kind: 'references',
            evidence: `Markdown link in ${doc.path}`,
          });
        }
        continue;
      }
      if (fromDoc.startsWith('../')) {
        const projectPath = resolveRelative(skill.sourcePath, `${dirname(doc.path)}/${target}`);
        const other = findSkillByProjectPath(projectPath);
        if (other && other.id !== skill.id) {
          addEdge({
            source: skillNodeId(skill.id),
            target: skillNodeId(other.id),
            kind: 'links-to-skill',
            evidence: `Markdown link in ${doc.path} resolves into ${other.sourcePath}`,
          });
        }
      }
    }

    for (const path of resourcePaths) {
      if (path === doc.path || linked.has(path)) continue;
      if (mentionsPath(doc.text, path)) {
        addEdge({
          source,
          target: fileNodeId(skill.id, path),
          kind: 'references',
          evidence: `Path mentioned in ${doc.path}`,
        });
      }
    }
  }

  return { nodes, edges: [...edges.values()] };
}
