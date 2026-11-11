import type { SkillDefinition } from '@skillarium/core/model';
import { ExternalLink, ImageOff } from 'lucide-react';
import { isValidElement, memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { siteUrl, skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
import { resolveLink } from '../lib/links';
import { CopyButton } from './ui';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/**
 * Renders untrusted Markdown.
 *
 * Safety properties this component relies on:
 * - react-markdown never renders raw HTML (no `rehype-raw`), so `<script>`,
 *   event handlers and iframes in a skill are dropped.
 * - its default URL transform removes `javascript:`, `data:` and other
 *   unexpected schemes before our components see them.
 * - remote images are never loaded; only image files indexed for this skill.
 */
export const Markdown = memo(function Markdown({
  content,
  skill,
  docPath,
}: {
  content: string;
  skill: SkillDefinition;
  /** Path of the document inside the skill, used to resolve relative links. */
  docPath: string;
}) {
  const { catalog } = useCatalog();

  const components: Components = {
    a({ href, children }) {
      const link = resolveLink(href, skill, docPath, catalog);
      switch (link.type) {
        case 'anchor':
          return <a href={link.href}>{children}</a>;
        case 'external':
          return (
            <a href={link.href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
              <ExternalLink className="ml-0.5 inline h-3 w-3 align-baseline opacity-60" aria-label="(external link)" />
            </a>
          );
        case 'internal':
          return <Link to={skillPath(link.skillId, link.file)}>{children}</Link>;
        default:
          return (
            <span className="underline decoration-dotted decoration-faint" title="This link does not resolve to an indexed file">
              {children}
            </span>
          );
      }
    },
    img({ src, alt }) {
      const link = resolveLink(typeof src === 'string' ? src : undefined, skill, docPath, catalog);
      if (link.type === 'internal' && link.resource?.preview === 'image' && link.resource.url) {
        return <img src={siteUrl(link.resource.url)} alt={alt ?? ''} loading="lazy" />;
      }
      const reason = link.type === 'external' ? 'Remote image not loaded' : 'Image not available';
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-1 text-[13px] text-muted">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          {reason}
          {alt ? `: ${alt}` : ''}
          {link.type === 'external' && (
            <a href={link.href} target="_blank" rel="noopener noreferrer nofollow">
              open
            </a>
          )}
        </span>
      );
    },
    pre({ children }) {
      return (
        <div className="codeblock group">
          <CopyButton
            text={() => textOf(children).replace(/\n$/, '')}
            label="Copy code"
            className="absolute right-2 top-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          />
          <pre tabIndex={0}>{children}</pre>
        </div>
      );
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };

  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeHighlight, { detect: false }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
