/**
 * Canonical, serializable Skillarium data model.
 *
 * This file must stay free of Node.js imports: the web application imports
 * its types, and everything here ends up in `catalog.json`.
 */

export const CATALOG_SCHEMA_VERSION = 1;

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface SkillDiagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine-readable code, e.g. `invalid-yaml`. */
  code: string;
  message: string;
  /** Path relative to the skill directory (or project root for global diagnostics). */
  file?: string;
}

/** Classification by the directory conventions of the Agent Skills spec. */
export type ResourceKind = 'script' | 'reference' | 'asset' | 'other';

export type PreviewKind = 'markdown' | 'text' | 'image' | 'none';

export interface SkillResource {
  /** POSIX path relative to the skill directory. */
  path: string;
  kind: ResourceKind;
  size: number;
  preview: PreviewKind;
  /** highlight.js language id for text previews. */
  language?: string;
  /**
   * URL path (relative to the site base) where the content is served.
   * Absent when the content is not published (binary, too large).
   */
  url?: string;
  /** Why the content is not available. */
  omitted?: 'too-large' | 'unsupported';
}

export interface SkillDefinition {
  /** Stable, URL-safe identifier. Unique within a catalog. */
  id: string;
  /** Frontmatter `name`, falling back to the directory name. */
  name: string;
  description: string;
  /** Id of the source (skill root) this skill was discovered in. */
  sourceId: string;
  /** POSIX path of the skill directory, relative to the project root. */
  sourcePath: string;
  /** The complete parsed frontmatter, unknown fields preserved. */
  metadata: Record<string, unknown>;
  /** Markdown body of SKILL.md (frontmatter removed). */
  content: string;
  resources: SkillResource[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillSource {
  id: string;
  /** POSIX path of the root relative to the project root, e.g. `.claude/skills`. */
  path: string;
}

export type GraphNodeType = 'skill' | ResourceKind;

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  skillId: string;
  /** Resource path within the skill, for file nodes. */
  path?: string;
}

export type GraphEdgeKind =
  /** The file lives inside the skill directory (filesystem fact). */
  | 'contains'
  /** A document explicitly links to or names the file's relative path. */
  | 'references'
  /** A document contains a Markdown link that resolves into another skill. */
  | 'links-to-skill';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  /** Human-readable statement of what the edge is grounded in. */
  evidence: string;
}

export interface SkillGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ProjectInfo {
  title: string;
  description?: string;
  /** Repository URL shown in the top navigation. */
  repository?: string;
  /** Template for source links; `{path}` is replaced by a project-relative path. */
  sourceUrl?: string;
}

export interface Catalog {
  schemaVersion: number;
  generator: { name: string; version: string };
  /** `dev` enables live reload in the viewer. */
  mode: 'dev' | 'static';
  project: ProjectInfo;
  /** Roots that were searched, whether or not they exist. */
  searched: string[];
  sources: SkillSource[];
  skills: SkillDefinition[];
  graph: SkillGraph;
  /** Diagnostics not attached to a single skill. */
  diagnostics: SkillDiagnostic[];
}
