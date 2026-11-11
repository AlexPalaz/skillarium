import type { Catalog, ResourceKind, SkillDefinition, SkillResource } from '@skillarium/core/model';

export function resource(path: string, kind: ResourceKind = 'other'): SkillResource {
  return { path, kind, size: 10, preview: 'text', url: `files/x/${path}.txt` } as SkillResource;
}

export function skill(
  name: string,
  sourcePath: string,
  files: string[] = [],
  extra: Partial<SkillDefinition> = {},
): SkillDefinition {
  return {
    id: name,
    name,
    description: `Does ${name}.`,
    sourcePath,
    sourceId: 'skills',
    metadata: { name },
    content: `# ${name}\n`,
    resources: files.map((file) => resource(file)),
    diagnostics: [],
    ...extra,
  } as SkillDefinition;
}

export function catalog(skills: SkillDefinition[], project: Partial<Catalog['project']> = {}): Catalog {
  return {
    project: { title: 'Test', ...project },
    skills,
    sources: [],
    searched: [],
    diagnostics: [],
    graph: { nodes: [], edges: [] },
  } as unknown as Catalog;
}
