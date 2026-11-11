import type { SkillDefinition, SkillResource } from '@skillarium/core/model';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { common, createLowlight } from 'lowlight';
import { ArrowLeft, ExternalLink, FileQuestion } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { Link } from 'react-router';
import { siteUrl, skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
import { formatBytes, sourceLink } from '../lib/links';
import { Markdown } from './Markdown';
import { CopyButton, KindBadge } from './ui';

const lowlight = createLowlight(common);

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; text: string };

function useFileText(resource: SkillResource, enabled: boolean): Loaded {
  const { revision } = useCatalog();
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  const url = resource.url;

  useEffect(() => {
    if (!enabled || !url) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(siteUrl(url), { signal: controller.signal, cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(
        (text) => setState({ status: 'ready', text }),
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        },
      );
    return () => controller.abort();
  }, [url, enabled, revision]);

  return state;
}

function Code({ text, language }: { text: string; language?: string }) {
  const tree = useMemo(() => {
    if (!language || language === 'plaintext' || !lowlight.registered(language)) return null;
    try {
      return toJsxRuntime(lowlight.highlight(language, text), { Fragment, jsx, jsxs });
    } catch {
      return null;
    }
  }, [text, language]);
  const lines = text.replace(/\n$/, '').split('\n').length;

  return (
    <div className="codeblock group overflow-hidden">
      <CopyButton
        text={text}
        label="Copy file contents"
        className="absolute right-2 top-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      />
      <div className="flex overflow-x-auto font-mono text-sm leading-[1.6]">
        <div aria-hidden="true" className="select-none border-r border-line px-3 py-3 text-right text-faint">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre tabIndex={0} className="flex-1 px-4 py-3" style={{ tabSize: 2 }}>
          <code>{tree ?? text}</code>
        </pre>
      </div>
    </div>
  );
}

function Unavailable({ resource }: { resource: SkillResource }) {
  const reason =
    resource.omitted === 'too-large'
      ? `This file is ${formatBytes(resource.size)}, above the preview size limit, so its content is not included.`
      : 'This file type cannot be previewed. Binary files are listed but their content is not included.';
  return (
    <div className="flex flex-col items-center rounded-lg border border-line px-6 py-12 text-center">
      <FileQuestion className="h-8 w-8 text-faint" aria-hidden="true" />
      <p className="mt-3 font-medium">No preview available</p>
      <p className="mt-1 max-w-md text-muted">{reason}</p>
    </div>
  );
}

export function FilePreview({ skill, resource }: { skill: SkillDefinition; resource: SkillResource }) {
  const { catalog } = useCatalog();
  const isText = resource.preview === 'text' || resource.preview === 'markdown';
  const loaded = useFileText(resource, isText && !!resource.url);
  const source = sourceLink(catalog, `${skill.sourcePath}/${resource.path}`);

  let body;
  if (!resource.url) {
    body = <Unavailable resource={resource} />;
  } else if (resource.preview === 'image') {
    body = (
      <div className="flex justify-center rounded-lg border border-line bg-sunken p-6">
        <img src={siteUrl(resource.url)} alt={resource.path} className="max-h-[70vh] max-w-full rounded-md" />
      </div>
    );
  } else if (loaded.status === 'loading') {
    body = <p className="text-muted" role="status">Loading {resource.path}…</p>;
  } else if (loaded.status === 'error') {
    body = <p className="text-danger" role="alert">Could not load this file ({loaded.message}).</p>;
  } else if (resource.preview === 'markdown') {
    body = <Markdown content={loaded.text} skill={skill} docPath={resource.path} />;
  } else {
    body = <Code text={loaded.text} language={resource.language} />;
  }

  return (
    <section aria-label={`File ${resource.path}`}>
      <Link to={skillPath(skill.id)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to instructions
      </Link>
      <div className="mb-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-4">
        <h2 className="break-all font-mono text-[15px] font-medium">{resource.path}</h2>
        <KindBadge kind={resource.kind} />
        <span className="text-[13px] text-faint">{formatBytes(resource.size)}</span>
        <span className="ml-auto flex items-center gap-2">
          <CopyButton text={resource.path} label="Copy relative path">Copy path</CopyButton>
          {source && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[13px] text-muted hover:border-line-strong hover:text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Source
            </a>
          )}
        </span>
      </div>
      {body}
    </section>
  );
}
