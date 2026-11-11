import { Link } from 'react-router';
import { skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
import { worstSeverity } from '../components/Diagnostics';
import { Page } from '../components/Layout';
import { NoSkills } from './Overview';

/** A dense, scannable index of every skill. */
export function Skills() {
  const { catalog } = useCatalog();
  const sourcePath = new Map(catalog.sources.map((s) => [s.id, s.path]));

  return (
    <Page>
      <h1 className="text-[40px] font-medium leading-[1.05] tracking-tight">Skills</h1>
      <p className="mt-1 text-muted">
        {catalog.skills.length} {catalog.skills.length === 1 ? 'skill' : 'skills'} across {catalog.sources.length}{' '}
        {catalog.sources.length === 1 ? 'location' : 'locations'}.
      </p>

      {catalog.skills.length === 0 ? (
        <div className="mt-6">
          <NoSkills />
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-[13px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Description</th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Location</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {catalog.skills.map((skill) => {
                const severity = worstSeverity(skill.diagnostics);
                return (
                  <tr key={skill.id} className="align-top hover:bg-sunken/60">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link to={skillPath(skill.id)} className="link">
                        {skill.name}
                      </Link>
                      {severity && (
                        <span className={`ml-2 text-[13px] font-normal ${severity === 'error' ? 'text-danger' : 'text-warn'}`}>
                          {severity}
                        </span>
                      )}
                      <p className="mt-1 line-clamp-2 font-normal text-muted sm:hidden">{skill.description}</p>
                    </th>
                    <td className="hidden max-w-md px-4 py-3 text-muted sm:table-cell">
                      <span className="line-clamp-2">{skill.description || '—'}</span>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-[13px] text-faint lg:table-cell">
                      {sourcePath.get(skill.sourceId)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{skill.resources.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
