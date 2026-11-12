import fs from 'node:fs';
import path from 'node:path';
import type { Catalog, SkillDefinition, SkillDiagnostic } from '@skillarium/core';
import { cac } from 'cac';
import pc from 'picocolors';
import { buildSite, DEFAULT_OUT_DIR, readBuildBase } from './build.js';
import { normalizeBase, UsageError } from './config.js';
import { indexWith, openProject } from './project.js';
import { startDevServer, startPreviewServer, type RunningServer } from './server.js';
import { VERSION } from './shell.js';

interface GlobalOptions {
  root?: string;
  config?: string;
}

const COMMANDS = ['dev', 'build', 'preview', 'list', 'inspect', 'check'];

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Skill content is untrusted, and a file name may hold a line break. Printed as
 * it is, the rest of the name would start a line of its own, which a CI runner
 * may take for a command. Show the break instead.
 */
function oneLine(text: string): string {
  return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function countIssues(catalog: Catalog): { errors: number; warnings: number } {
  const all: SkillDiagnostic[] = [...catalog.diagnostics, ...catalog.skills.flatMap((s) => s.diagnostics)];
  return {
    errors: all.filter((d) => d.severity === 'error').length,
    warnings: all.filter((d) => d.severity === 'warning').length,
  };
}

function summary(catalog: Catalog): string {
  const { errors, warnings } = countIssues(catalog);
  const parts = [plural(catalog.skills.length, 'skill')];
  if (errors) parts.push(pc.red(plural(errors, 'error')));
  if (warnings) parts.push(pc.yellow(plural(warnings, 'warning')));
  return parts.join(', ');
}

function printDiagnostics(catalog: Catalog): void {
  const rows: [string, SkillDiagnostic][] = [
    ...catalog.diagnostics.map((d): [string, SkillDiagnostic] => [d.file ?? '', d]),
    ...catalog.skills.flatMap((s) => s.diagnostics.map((d): [string, SkillDiagnostic] => [s.sourcePath, d])),
  ];
  for (const [where, diagnostic] of rows) {
    if (diagnostic.severity === 'info') continue;
    const tag = diagnostic.severity === 'error' ? pc.red('error') : pc.yellow('warn ');
    console.error(`  ${tag} ${pc.dim(oneLine(where))} ${oneLine(diagnostic.message)}`);
  }
}

function noSkillsHint(catalog: Catalog): void {
  console.error(pc.yellow('No Agent Skills found.'));
  console.error(pc.dim(`Searched: ${catalog.searched.join(', ')}`));
  console.error(pc.dim('Add a directory containing a SKILL.md, or set "skills" in skillarium.config.ts.'));
}

/** Keep the process alive until SIGINT/SIGTERM, then shut the server down. */
function untilSignal(server: RunningServer): Promise<void> {
  return new Promise((resolve) => {
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void server.close().then(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function parsePort(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid port "${String(value)}": expected an integer between 0 and 65535.`);
  }
  return port;
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    // Not being able to open a browser is never fatal.
  }
}

const cli = cac('skillarium');

cli
  .option('--root <dir>', 'Project root to scan (default: current directory)')
  .option('--config <file>', 'Path to a config file (default: skillarium.config.ts)');

cli
  .command('dev', 'Start the local viewer and watch skills for changes (default command)')
  .option('--port <port>', 'Port to listen on (default: 4400)')
  .option('--host <host>', 'Address to bind to (default: 127.0.0.1)')
  .option('--no-open', 'Do not open the browser')
  .example('skillarium dev --root ./project --port 4000 --no-open')
  .action(async (options: GlobalOptions & { port?: unknown; host?: string; open: boolean }) => {
    const project = await openProject(options);
    const port = parsePort(options.port);
    const server = await startDevServer({
      project,
      port,
      strictPort: port !== undefined,
      host: options.host,
      onIndex(result, reason) {
        if (reason === 'change') {
          const time = new Date().toLocaleTimeString();
          console.log(`${pc.dim(time)} reindexed: ${summary(result.catalog)}`);
          printDiagnostics(result.catalog);
        }
      },
    });
    const { catalog } = server.current();

    console.log(`\n  ${pc.bold(pc.green('Skillarium'))} ${pc.dim(`v${VERSION}`)}\n`);
    console.log(`  ${pc.dim('Viewer ')} ${pc.cyan(server.url)}`);
    console.log(`  ${pc.dim('Project')} ${catalog.project.title} — ${summary(catalog)}`);
    if (options.host && !['127.0.0.1', 'localhost', '::1'].includes(options.host)) {
      console.log(pc.yellow(`\n  The viewer is reachable from other machines on ${options.host}.`));
    }
    console.log(pc.dim('\n  Watching for changes. Press Ctrl+C to stop.\n'));
    if (catalog.skills.length === 0) noSkillsHint(catalog);
    printDiagnostics(catalog);

    if (options.open && !process.env.CI && process.stdout.isTTY) void openBrowser(server.url);
    await untilSignal(server);
  });

cli
  .command('build', 'Generate a static documentation site')
  .option('--out-dir <dir>', `Output directory (default: ./${DEFAULT_OUT_DIR})`)
  .option('--base <path>', 'Public base path, e.g. /my-repo/ for GitHub Pages (default: /)')
  .option('--strict', 'Exit with an error when any skill has an error diagnostic')
  .example('skillarium build --out-dir ./dist --base /my-skills/')
  .action(async (options: GlobalOptions & { outDir?: string; base?: string; strict?: boolean }) => {
    const project = await openProject(options);
    const started = Date.now();
    const result = await buildSite({ project, outDir: options.outDir, base: options.base });
    const { errors } = countIssues(result.catalog);

    if (result.catalog.skills.length === 0) noSkillsHint(result.catalog);
    printDiagnostics(result.catalog);
    console.log(
      `${pc.green('✓')} Built ${summary(result.catalog)} into ${pc.bold(path.relative(process.cwd(), result.outDir) || '.')} ` +
        pc.dim(`(${plural(result.pages, 'page')}, ${plural(result.files, 'file')}, base ${result.base}, ${Date.now() - started} ms)`),
    );
    console.log(pc.dim('  Preview it with: skillarium preview'));
    if (options.strict && errors > 0) {
      console.error(pc.red(`--strict: ${plural(errors, 'error')} found.`));
      process.exitCode = 1;
    }
  });

cli
  .command('preview', 'Serve the generated static site locally')
  .option('--out-dir <dir>', `Directory to serve (default: ./${DEFAULT_OUT_DIR})`)
  .option('--base <path>', 'Base path to serve under (default: the one used by the build)')
  .option('--port <port>', 'Port to listen on (default: 4500)')
  .option('--host <host>', 'Address to bind to (default: 127.0.0.1)')
  .option('--open', 'Open the browser')
  .action(async (options: GlobalOptions & { outDir?: string; base?: string; port?: unknown; host?: string; open?: boolean }) => {
    const project = await openProject(options);
    const dir = path.resolve(project.root, options.outDir ?? project.config.outDir ?? DEFAULT_OUT_DIR);
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      throw new UsageError(`No built site found in ${dir}. Run \`skillarium build\` first.`);
    }
    const base = normalizeBase(options.base ?? (await readBuildBase(dir)) ?? project.config.base);
    const port = parsePort(options.port);
    const server = await startPreviewServer({ dir, base, port, strictPort: port !== undefined, host: options.host });
    console.log(`\n  ${pc.bold(pc.green('Skillarium'))} ${pc.dim('static preview')}\n`);
    console.log(`  ${pc.dim('Site')} ${pc.cyan(server.url)}`);
    console.log(pc.dim('\n  Served exactly like a static host: no rewrites, no fallback. Press Ctrl+C to stop.\n'));
    if (options.open) void openBrowser(server.url);
    await untilSignal(server);
  });

cli
  .command('list', 'List the skills found in the project')
  .option('--json', 'Print machine-readable JSON')
  .action(async (options: GlobalOptions & { json?: boolean }) => {
    const project = await openProject(options);
    const { catalog } = await indexWith(project, 'static');

    if (options.json) {
      const rows = catalog.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        path: skill.sourcePath,
        files: skill.resources.length,
        diagnostics: skill.diagnostics,
      }));
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (catalog.skills.length === 0) {
      noSkillsHint(catalog);
      return;
    }
    const width = Math.max(...catalog.skills.map((s) => s.name.length), 4);
    console.log(pc.dim(`${'NAME'.padEnd(width)}  FILES  PATH`));
    for (const skill of catalog.skills) {
      const errors = skill.diagnostics.filter((d) => d.severity === 'error').length;
      const warnings = skill.diagnostics.filter((d) => d.severity === 'warning').length;
      const flags = [errors && pc.red(plural(errors, 'error')), warnings && pc.yellow(plural(warnings, 'warning'))]
        .filter(Boolean)
        .join(', ');
      console.log(
        `${pc.bold(skill.name.padEnd(width))}  ${String(skill.resources.length).padStart(5)}  ${pc.dim(skill.sourcePath)}${flags ? `  ${flags}` : ''}`,
      );
    }
    console.log(pc.dim(`\n${summary(catalog)}`));
    const wide = catalog.diagnostics.find((d) => d.code === 'searched-whole-project');
    if (wide) console.log(pc.dim(wide.message));
  });

function findSkill(catalog: Catalog, query: string): SkillDefinition {
  const byId = catalog.skills.find((s) => s.id === query);
  if (byId) return byId;
  const byName = catalog.skills.filter((s) => s.name === query);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new UsageError(
      `"${query}" is ambiguous. Use one of these ids: ${byName.map((s) => s.id).join(', ')}`,
    );
  }
  const names = catalog.skills.map((s) => s.id);
  throw new UsageError(
    `No skill named "${query}".${names.length ? ` Available: ${names.join(', ')}` : ' No skills were found in this project.'}`,
  );
}

cli
  .command('inspect <skill>', 'Show the details of one skill (by name or id)')
  .option('--json', 'Print machine-readable JSON')
  .action(async (query: string, options: GlobalOptions & { json?: boolean }) => {
    const project = await openProject(options);
    const { catalog } = await indexWith(project, 'static');
    const skill = findSkill(catalog, query);

    if (options.json) {
      console.log(JSON.stringify(skill, null, 2));
      return;
    }
    const keys = ['instructions', ...Object.keys(skill.metadata)];
    const width = Math.max(...keys.map((key) => key.length)) + 2;
    const label = (text: string) => pc.dim(text.padEnd(width));
    console.log(pc.bold(skill.name));
    if (skill.description) console.log(skill.description);
    console.log();
    console.log(`${label('id')}${skill.id}`);
    console.log(`${label('path')}${skill.sourcePath}`);
    for (const [key, value] of Object.entries(skill.metadata)) {
      if (key === 'name' || key === 'description') continue;
      console.log(`${label(key)}${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    console.log(`${label('instructions')}${plural(skill.content.split('\n').length, 'line')}`);

    console.log(`\n${pc.dim('Files')} (${skill.resources.length})`);
    for (const resource of skill.resources) {
      console.log(`  ${oneLine(resource.path)} ${pc.dim(`${resource.kind}, ${resource.size} B`)}`);
    }
    const references = catalog.graph.edges.filter(
      (edge) => edge.kind !== 'contains' && (edge.source === `skill:${skill.id}` || edge.source.startsWith(`file:${skill.id}:`)),
    );
    if (references.length > 0) {
      console.log(`\n${pc.dim('Explicit references')} (${references.length})`);
      for (const edge of references) {
        console.log(`  ${oneLine(edge.target.replace(/^(file:[^:]+:|skill:)/, ''))} ${pc.dim(`— ${oneLine(edge.evidence)}`)}`);
      }
    }
    if (skill.diagnostics.length > 0) {
      console.log(`\n${pc.dim('Diagnostics')}`);
      for (const d of skill.diagnostics) {
        const tag = d.severity === 'error' ? pc.red('error') : d.severity === 'warning' ? pc.yellow('warn ') : pc.dim('note ');
        console.log(`  ${tag} ${oneLine(d.message)} ${pc.dim(d.code)}`);
      }
    }
  });

/** One error or warning of `check`, with the place it belongs to. */
interface CheckDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Id of the skill; absent for a problem of the project itself. */
  skill?: string;
  /** Skill directory, or the place a project-level problem was found. */
  path: string;
  /** File inside the skill. */
  file?: string;
}

/** Errors and warnings of a catalog: project-level ones first, then skill by skill. */
function checkDiagnostics(catalog: Catalog): CheckDiagnostic[] {
  const out: CheckDiagnostic[] = [];
  for (const d of catalog.diagnostics) {
    if (d.severity === 'info') continue;
    out.push({ severity: d.severity, code: d.code, message: d.message, path: d.file ?? '.' });
  }
  for (const skill of catalog.skills) {
    for (const d of skill.diagnostics) {
      if (d.severity === 'info') continue;
      const row: CheckDiagnostic = { severity: d.severity, code: d.code, message: d.message, skill: skill.id, path: skill.sourcePath };
      if (d.file) row.file = d.file;
      out.push(row);
    }
  }
  return out;
}

/** The text of a GitHub Actions workflow command, with what would end or split it encoded. */
function commandData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** A property of a workflow command; `:` and `,` separate properties, so they are encoded too. */
function commandProperty(text: string): string {
  return commandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * The diagnostics as GitHub Actions annotations, one workflow command per line.
 * A skill's problem is put on its file, by a path from the repository; a
 * problem of the project has no file.
 */
function githubAnnotations(root: string, catalog: Catalog, diagnostics: CheckDiagnostic[]): string[] {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const lines = diagnostics.map((d) => {
    const properties: string[] = [];
    if (d.skill !== undefined) {
      const file = path.relative(workspace, path.resolve(root, d.path, d.file ?? 'SKILL.md')).split(path.sep).join('/');
      if (!file.startsWith('../') && !path.isAbsolute(file)) properties.push(`file=${commandProperty(file)}`);
    }
    properties.push(`title=${commandProperty(d.code)}`);
    return `::${d.severity} ${properties.join(',')}::${commandData(d.message)}`;
  });
  if (catalog.skills.length === 0) lines.push('::error title=no-skills::No Agent Skills found.');
  return lines;
}

cli
  .command('check', 'Report problems and set the exit code, without writing anything (for CI)')
  .option('--fail-on <severity>', 'Lowest severity that fails the check: error or warning (default: error)')
  .option('--json', 'Print machine-readable JSON')
  .example('skillarium check --fail-on warning')
  .action(async (options: GlobalOptions & { failOn?: unknown; json?: boolean }) => {
    const failOn = options.failOn ?? 'error';
    if (failOn !== 'error' && failOn !== 'warning') {
      throw new UsageError(`Invalid --fail-on "${String(failOn)}": expected "error" or "warning".`);
    }
    const project = await openProject(options);
    const { catalog } = await indexWith(project, 'static');
    const diagnostics = checkDiagnostics(catalog);
    const errors = diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = diagnostics.length - errors;
    const ok = catalog.skills.length > 0 && errors === 0 && (failOn === 'error' || warnings === 0);
    if (!ok) process.exitCode = 1;

    if (options.json) {
      console.log(JSON.stringify({ ok, skills: catalog.skills.length, errors, warnings, diagnostics }, null, 2));
      return;
    }
    for (const d of diagnostics) {
      const tag = d.severity === 'error' ? pc.red('error') : pc.yellow('warn ');
      console.log(`${tag} ${pc.dim(oneLine(d.path))} ${oneLine(d.message)} ${pc.dim(d.code)}`);
    }
    if (diagnostics.length > 0) console.log();
    if (catalog.skills.length === 0) noSkillsHint(catalog);
    console.log(`${ok ? pc.green('✓') : pc.red('✗')} ${summary(catalog)}`);
    if (!ok && errors === 0 && warnings > 0) console.log(pc.dim('  Warnings fail this check because of --fail-on warning.'));
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const line of githubAnnotations(project.root, catalog, diagnostics)) console.log(line);
    }
  });

cli.help();
cli.version(VERSION);

async function main(): Promise<void> {
  // `skillarium` with no command is `skillarium dev`.
  const argv = process.argv.slice();
  const args = argv.slice(2);
  const takesValue = new Set(['--root', '--config', '--port', '--host', '--out-dir', '--base', '--fail-on']);
  const first = args.find((arg, i) => !arg.startsWith('-') && !takesValue.has(args[i - 1] ?? ''));
  const wantsInfo = args.some((arg) => ['-h', '--help', '-v', '--version'].includes(arg));
  if (first === undefined) {
    if (!wantsInfo) argv.splice(2, 0, 'dev');
  } else if (!COMMANDS.includes(first)) {
    throw new UsageError(`Unknown command "${first}". Run \`skillarium --help\` to see the available commands.`);
  }

  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}

main().catch((error: unknown) => {
  const usage = error instanceof UsageError || (error instanceof Error && error.name === 'CACError');
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${pc.red('error')} ${message}`);
  if (!usage && process.env.DEBUG && error instanceof Error) console.error(error.stack);
  process.exitCode = usage ? 2 : 1;
});
