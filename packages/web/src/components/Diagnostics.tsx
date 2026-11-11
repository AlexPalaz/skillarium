import type { SkillDiagnostic } from '@skillarium/core/model';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

const STYLE = {
  error: { icon: CircleAlert, color: 'text-danger', label: 'Error' },
  warning: { icon: TriangleAlert, color: 'text-warn', label: 'Warning' },
  info: { icon: Info, color: 'text-muted', label: 'Note' },
} as const;

export function worstSeverity(diagnostics: SkillDiagnostic[]): 'error' | 'warning' | null {
  if (diagnostics.some((d) => d.severity === 'error')) return 'error';
  if (diagnostics.some((d) => d.severity === 'warning')) return 'warning';
  return null;
}

export function DiagnosticList({
  diagnostics,
  prefix,
}: {
  diagnostics: SkillDiagnostic[];
  prefix?: (diagnostic: SkillDiagnostic) => ReactNode;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line" aria-label="Diagnostics">
      {diagnostics.map((diagnostic, index) => {
        const { icon: Icon, color, label } = STYLE[diagnostic.severity];
        return (
          <li key={index} className="flex gap-2.5 px-3 py-2.5 text-sm">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-label={label} />
            <div className="min-w-0">
              {prefix?.(diagnostic)}
              <span>{diagnostic.message}</span>
              <span className="ml-2 font-mono text-[13px] text-faint">
                {diagnostic.code}
                {diagnostic.file ? ` · ${diagnostic.file}` : ''}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
