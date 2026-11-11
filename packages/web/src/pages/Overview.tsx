import type { SkillDefinition } from '@skillarium/core/model';
import { Link } from 'react-router';
import { skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
import { DiagnosticList } from '../components/Diagnostics';
import { Page } from '../components/Layout';
import { EmptyState, KindBadge } from '../components/ui';

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-t border-line py-4 pr-4">
      <dd className="text-[34px] font-medium leading-none tracking-tight tabular-nums">{value}</dd>
      <dt className="label mt-2">{label}</dt>
    </div>
  );
}

export function NoSkills() {
  const { catalog } = useCatalog();
  return (
    <EmptyState title="No Agent Skills found">
      <p>
        Skillarium looks for directories containing a <code className="font-mono text-sm">SKILL.md</code> file in
        these locations:
      </p>
      <ul className="mx-auto mt-3 inline-block text-left font-mono text-sm">
        {catalog.searched.map((path) => (
          <li key={path}>{path}/</li>
        ))}
      </ul>
      <p className="mt-3">
        Add a skill to one of them, or list other folders under <code className="font-mono text-sm">skills</code> in{' '}
        <code className="font-mono text-sm">skillarium.config.ts</code>.
      </p>
    </EmptyState>
  );
}

export function SkillCard({ skill }: { skill: SkillDefinition }) {
  const counts = { script: 0, reference: 0, asset: 0, other: 0 };
  for (const resource of skill.resources) counts[resource.kind]++;
  return (
    <Link
      to={skillPath(skill.id)}
      className="lift group flex flex-col rounded-lg border border-line bg-surface p-5"
    >
      <h3 className="text-[17px] font-medium tracking-tight">{skill.name}</h3>
      <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted">
        {skill.description || <span className="italic text-faint">No description.</span>}
      </p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {(['script', 'reference', 'asset', 'other'] as const).map(
          (kind) =>
            counts[kind] > 0 && (
              <KindBadge key={kind} kind={kind}>
                {counts[kind]} {kind}
                {counts[kind] === 1 ? '' : 's'}
              </KindBadge>
            ),
        )}
        {skill.resources.length === 0 && <span className="text-[13px] text-faint">Instructions only</span>}
      </div>
    </Link>
  );
}

export function Overview() {
  const { catalog } = useCatalog();
  const { skills, sources, project } = catalog;
  const resources = skills.reduce((sum, skill) => sum + skill.resources.length, 0);
  const flagged = skills.filter((s) => s.diagnostics.some((d) => d.severity !== 'info'));
  const references = catalog.graph.edges.filter((e) => e.kind !== 'contains').length;

  return (
    <Page>
      <p className="label">Agent Skills</p>
      <h1 className="mt-3 text-[40px] font-medium leading-[1.05] tracking-tight sm:text-[52px]">{project.title}</h1>
      {project.description && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{project.description}</p>}

      {skills.length === 0 ? (
        <div className="mt-8">
          <NoSkills />
        </div>
      ) : (
        <>
          <dl className="mt-10 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <Stat value={skills.length} label={skills.length === 1 ? 'Skill' : 'Skills'} />
            <Stat value={resources} label="Supporting files" />
            <Stat value={references} label="Explicit references" />
            <Stat value={flagged.length} label="Skills with issues" />
          </dl>

          {sources.map((source) => {
            const inSource = skills.filter((s) => s.sourceId === source.id);
            return (
              <section key={source.id} className="mt-12" aria-labelledby={`source-${source.id}`}>
                <h2 id={`source-${source.id}`} className="flex items-baseline gap-3">
                  <span className="text-xl font-medium tracking-tight">{source.path}/</span>
                  <span className="text-[13px] text-faint">
                    {inSource.length} {inSource.length === 1 ? 'skill' : 'skills'}
                  </span>
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {inSource.map((skill) => (
                    <SkillCard key={skill.id} skill={skill} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {(flagged.length > 0 || catalog.diagnostics.length > 0) && (
        <section className="mt-10" aria-labelledby="diagnostics-heading">
          <h2 id="diagnostics-heading" className="text-xl font-medium tracking-tight">
            Diagnostics
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted">
            Problems found while indexing. Skills are still shown so they can be fixed.
          </p>
          <DiagnosticList
            diagnostics={[
              ...catalog.diagnostics,
              ...flagged.flatMap((skill) =>
                skill.diagnostics.filter((d) => d.severity !== 'info').map((d) => ({ ...d, file: skill.id })),
              ),
            ]}
            prefix={(diagnostic) => {
              const skill = skills.find((s) => s.id === diagnostic.file);
              return skill ? (
                <Link to={skillPath(skill.id)} className="mr-2 font-medium text-accent hover:underline">
                  {skill.name}
                </Link>
              ) : null;
            }}
          />
        </section>
      )}
    </Page>
  );
}
