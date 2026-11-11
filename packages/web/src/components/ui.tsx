import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The mark: a diamond above an open book, in the accent colour. */
export function Logo({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true" />;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label,
  className = '',
  children,
}: {
  /** Text, or a function evaluated at click time. */
  text: string | (() => string);
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={`btn-step inline-flex items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1 text-[13px] font-medium text-muted hover:border-line-strong hover:text-fg ${className}`}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (await writeClipboard(typeof text === 'function' ? text() : text)) {
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

const KIND_STYLES: Record<string, string> = {
  script: 'text-script border-script/30 bg-script/10',
  reference: 'text-reference border-reference/30 bg-reference/10',
  asset: 'text-asset border-asset/30 bg-asset/10',
  other: 'text-muted border-line bg-sunken',
};

export function KindBadge({ kind, children }: { kind: string; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[13px] font-medium leading-4 ${KIND_STYLES[kind] ?? KIND_STYLES.other}`}
    >
      {children ?? kind}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-6 py-12 text-center">
      <h2 className="text-xl font-medium tracking-tight">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-xl text-muted">{children}</div>}
    </div>
  );
}
