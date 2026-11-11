import type { SkillDefinition } from '@skillarium/core/model';
import GithubSlugger from 'github-slugger';
import { ExternalLink, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useCatalog } from '../lib/catalog';
import { sourceLink } from '../lib/links';
import { DiagnosticList } from '../components/Diagnostics';
import { FilePreview } from '../components/FilePreview';
import { FileTree } from '../components/FileTree';
import { Page } from '../components/Layout';
import { Markdown } from '../components/Markdown';
import { CopyButton, EmptyState } from '../components/ui';

interface TocEntry {
  depth: number;
  text: string;
  id: string;
}

/** Headings of a Markdown document, with the same ids `rehype-slug` assigns. */
function tableOfContents(markdown: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const text = heading[2]!
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim();
    const id = slugger.slug(text); // every heading consumes a slug, like rehype-slug
    const depth = heading[1]!.length;
    if (depth === 2 || depth === 3) entries.push({ depth, text, id });
  }
  return entries;
}

function formatValue(value: unknown): ReactNode {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return <code className="font-mono text-[13px]">{JSON.stringify(value)}</code>;
}

/** Frontmatter beyond name and description, flattened one level for `metadata`. */
function metadataRows(skill: SkillDefinition): { key: string; value: ReactNode }[] {
  const rows: { key: string; value: ReactNode }[] = [];
  for (const [key, value] of Object.entries(skill.metadata)) {
    if (key === 'name' || key === 'description') continue;
    if (key === 'metadata' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value)) rows.push({ key: inner, value: formatValue(innerValue) });
    } else if (key === 'allowed-tools' && typeof value === 'string') {
      rows.push({
        key,
        value: (
          <span className="flex flex-wrap gap-1">
            {value.split(/\s+/).filter(Boolean).map((tool) => (
              <code key={tool} className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[13px]">
                {tool}
              </code>
            ))}
          </span>
        ),
      });
    } else {
      rows.push({ key, value: formatValue(value) });
    }
  }
  return rows;
}

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 label">{title}</h2>
      {children}
    </section>
  );
}

export function Skill() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { catalog, skillsById } = useCatalog();
  const skill = id ? skillsById.get(id) : undefined;
  const filePath = params.get('file') ?? undefined;
  const resource = skill && filePath ? skill.resources.find((r) => r.path === filePath) : undefined;

  const toc = useMemo(() => (skill ? tableOfContents(skill.content) : []), [skill]);
  const rows = useMemo(() => (skill ? metadataRows(skill) : []), [skill]);

  useEffect(() => {
    if (skill) document.title = `${resource ? `${resource.path} · ` : ''}${skill.name} · ${catalog.project.title}`;
  }, [skill, resource, catalog.project.title]);

  // Start each skill or file at the top, unless the URL targets a heading.
  useEffect(() => {
    if (!window.location.hash) document.getElementById('main')?.scrollTo({ top: 0 });
  }, [id, filePath]);

  if (!skill) {
    return (
      <Page>
        <EmptyState title="Skill not found">
          <p>
            There is no skill with the id <code className="font-mono">{id}</code> in this catalog.{' '}
            <Link to="/skills/" className="text-accent underline">
              Browse all skills
            </Link>
            .
          </p>
        </EmptyState>
      </Page>
    );
  }

  const source = sourceLink(catalog, `${skill.sourcePath}/SKILL.md`);

  return (
    <Page wide>
      <header className="border-b border-line pb-8">
        <h1 className="break-words text-[36px] font-medium leading-[1.1] tracking-tight sm:text-[44px]">{skill.name}</h1>
        {skill.description ? (
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted">{skill.description}</p>
        ) : (
          <p className="mt-2 italic text-faint">This skill has no description.</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-muted">
            <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title="Source location">{skill.sourcePath}</span>
          </span>
          <CopyButton text={skill.sourcePath} label="Copy source path" />
          {source && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-muted hover:border-line-strong hover:text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> View source
            </a>
          )}
        </div>
      </header>

      <div className="mt-8 grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_264px]">
        <aside className="lg:order-last">
          <div className="lg:sticky lg:top-6">
            <RailSection title="Files">
              <div className="rounded-lg border border-line p-1.5">
                <FileTree skill={skill} selected={resource?.path} />
              </div>
            </RailSection>
            {!filePath && toc.length >= 3 && (
              <div className="hidden lg:block">
                <RailSection title="On this page">
                  <ul className="border-l border-line text-sm">
                    {toc.map((entry) => (
                      <li key={entry.id}>
                        <a
                          href={`#${entry.id}`}
                          className={`-ml-px block border-l border-transparent py-1 text-muted hover:border-accent hover:text-fg ${entry.depth === 3 ? 'pl-6' : 'pl-3'}`}
                        >
                          {entry.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </RailSection>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {filePath && !resource ? (
            <EmptyState title="File not found">
              <p>
                <code className="font-mono">{filePath}</code> is not one of this skill's indexed files.
              </p>
            </EmptyState>
          ) : resource ? (
            <FilePreview skill={skill} resource={resource} />
          ) : (
            <>
              {skill.diagnostics.length > 0 && (
                <div className="mb-6">
                  <DiagnosticList diagnostics={skill.diagnostics} />
                </div>
              )}
              {rows.length > 0 && (
                <section aria-labelledby="metadata-heading" className="mb-8">
                  <h2 id="metadata-heading" className="mb-2 label">
                    Metadata
                  </h2>
                  <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line text-sm">
                    {rows.map((row) => (
                      <div key={row.key} className="grid grid-cols-[minmax(90px,150px)_minmax(0,1fr)] gap-3 px-3 py-2">
                        <dt className="break-words font-mono text-[13px] leading-5 text-muted">{row.key}</dt>
                        <dd className="min-w-0 break-words">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section aria-labelledby="instructions-heading">
                <h2 id="instructions-heading" className="mb-3 label">
                  Instructions
                </h2>
                {skill.content.trim() ? (
                  <Markdown content={skill.content} skill={skill} docPath="SKILL.md" />
                ) : (
                  <p className="italic text-faint">SKILL.md has no instructions.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
