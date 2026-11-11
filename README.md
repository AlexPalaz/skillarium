<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/skillarium-wordmark-dark.svg">
    <img src="docs/assets/skillarium-wordmark-light.svg" alt="Skillarium" width="420">
  </picture>
</h1>

<p align="center">
  <strong>The open-source workspace for Agent Skills.</strong><br>
  Explore, document, and share the skills in your repository.
</p>

<p align="center">
  <a href="https://github.com/AlexPalaz/skillarium/actions/workflows/ci.yml"><img src="https://github.com/AlexPalaz/skillarium/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f6b1f" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020.19-2f6b1f" alt="Node.js 20.19 or newer">
</p>

<p align="center">
  <a href="#usage">Usage</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/deployment.md">Deployment</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/security.md">Security</a>
</p>

Skillarium is to Agent Skills what Storybook is to UI components: point it at a project and it turns the `SKILL.md` files and their supporting scripts, references and assets into a searchable, browsable site — locally while you work, or as a static website you can publish.

```bash
npx skillarium dev      # explore your skills in the browser
npx skillarium build    # generate a static documentation site
```

No configuration, no account, no API key, no changes to your skills.

> **Status:** early (`0.1.0`), not yet published to npm. Until it is, use it [from source](#from-source).

## Why

[Agent Skills](https://agentskills.io) extend coding agents such as Claude Code and Codex with instructions, scripts and resources. They live as folders spread across a repository (`.claude/skills/`, `.agents/skills/`, `skills/`, …), so answering *“what skills does this project have, and what does each one do?”* means opening directories and reading raw Markdown one file at a time.

Skillarium reads those folders and gives you:

- **A skill explorer** — every skill in a sidebar, grouped by location, with rendered instructions, metadata and a table of contents.
- **A resource browser** — the file tree of each skill, with syntax-highlighted source, rendered Markdown references and image previews.
- **Search** — instant, offline full-text search over names, descriptions, metadata, instructions and file names.
- **An architecture view** — a graph of skills and their files. Every line is a fact: either the file is in the skill's folder, or a document explicitly links to or names it. Nothing is inferred.
- **Diagnostics** — problems measured against the [Agent Skills specification](https://agentskills.io/specification) (missing `description`, invalid YAML, a `name` that does not match its folder, …). Broken skills are still shown, so you can fix them.
- **A static site** — the same viewer as plain files you can host anywhere.

It is read-only: Skillarium never modifies your skills and never executes anything inside them.

## Usage

### Explore locally

```bash
cd my-project
npx skillarium dev
```

Skillarium finds the skills, starts a server on `http://127.0.0.1:4400`, and opens your browser. Edit a `SKILL.md` and the page updates.

Running `skillarium` with no command is the same as `skillarium dev`.

### Publish a static site

```bash
npx skillarium build                     # writes ./skillarium-dist
npx skillarium preview                   # serve it locally, exactly like a static host
```

The output needs no Node.js and no backend. Every page is a real HTML file, so direct links and refresh work on any static host without rewrite rules. For a site served from a sub-path — such as GitHub Pages project sites — pass the base path:

```bash
npx skillarium build --base /my-repo/
```

See [docs/deployment.md](docs/deployment.md) for GitHub Pages, Cloudflare Pages, Netlify and Vercel.

### Inspect from the terminal

```bash
npx skillarium list                      # table of skills
npx skillarium list --json               # for scripts and CI
npx skillarium inspect pdf-processing    # one skill: metadata, files, references, diagnostics
```

### Check in CI

```bash
npx skillarium check                     # exit 1 if a skill has an error
npx skillarium check --fail-on warning   # warnings fail too
npx skillarium check --json              # counts and problems, for scripts
```

`check` reads the skills, prints every error and warning with the skill it belongs to, and sets the exit code. It writes no files and starts no server, so it is the command to run on every pull request; `build` is for publishing. A project in which no skill is found fails the check, because in CI that usually means a wrong `--root` or `skills` setting.

### Commands

| Command | What it does |
| --- | --- |
| `skillarium check` | Report problems and set the exit code, without writing anything. Options: `--fail-on <error\|warning>` (default `error`), `--json`. |
| `skillarium dev` | Start the local viewer and watch skills for changes. Options: `--port`, `--host`, `--no-open`. |
| `skillarium build` | Generate the static site. Options: `--out-dir`, `--base`, `--strict` (exit 1 if a skill has errors). |
| `skillarium preview` | Serve the generated site locally. Options: `--out-dir`, `--port`, `--open`. |
| `skillarium list` | List discovered skills. Option: `--json`. |
| `skillarium inspect <skill>` | Show one skill by name or id. Option: `--json`. |

Every command accepts `--root <dir>` (project to scan, default: current directory) and `--config <file>`.

Exit codes: `0` success, `1` failure (including a failed `check`), `2` usage error (unknown command, bad option, unknown skill).

## Where skills are found

Without configuration, Skillarium searches these directories for folders that contain a `SKILL.md`, at any depth:

```text
.agents/skills/   .claude/skills/   .codex/skills/   .cursor/skills/
.gemini/skills/   .github/skills/   .opencode/skills/   skills/
```

Hidden files and folders, `node_modules`, and files that look like keys or certificates are skipped. Add a `.skillariumignore` (gitignore syntax) to exclude more.

## Configuration

Optional. Create `skillarium.config.ts` in the project root to set a title, add skill folders, or configure the build:

```ts
import { defineConfig } from 'skillarium';

export default defineConfig({
  title: 'Engineering Agent Skills',
  description: 'Our reusable AI agent capabilities',
  skills: ['./skills', './.agents/skills'],
  outDir: './skillarium-dist',
  base: '/',
  repository: 'https://github.com/acme/skills',
  sourceUrl: 'https://github.com/acme/skills/blob/main/{path}',
});
```

All options are described in [docs/configuration.md](docs/configuration.md). The config file is ordinary project code and is executed when Skillarium starts, like `vite.config.ts`; skill content never is.

## How it compares to a Markdown viewer

A Markdown previewer or a GitHub file view renders one file at a time. Skillarium understands the *skill* as a unit:

| | Markdown viewer | Skillarium |
| --- | --- | --- |
| Finds every skill in a repository | No — you browse folders | Yes, across all known locations |
| Parses frontmatter into metadata | Shown as raw YAML or a table | Yes, with validation against the spec |
| Links between `SKILL.md`, references and scripts | Depends on the viewer | Resolved inside the skill and across skills |
| Search across all skills | No | Yes, offline |
| Structure overview | No | Architecture graph of skills and files |
| Publishable site | No | Static build with one command |

If you only need to read a single `SKILL.md`, a Markdown viewer is enough.

## Security

Skills are treated as untrusted input. Skillarium never executes scripts, never renders raw HTML from Markdown, never loads remote images, never follows symlinks out of a skill folder, and only serves the files it indexed. The development server binds to `127.0.0.1`. Details and known limitations are in [docs/security.md](docs/security.md); to report a vulnerability see [SECURITY.md](SECURITY.md).

## From source

Requires Node.js 20.19 or newer and [pnpm](https://pnpm.io) 9 (`corepack enable` provides it).

```bash
git clone <repository-url> skillarium && cd skillarium
pnpm install
pnpm build

pnpm dev:example                              # viewer for the bundled example project
node packages/cli/bin/skillarium.js dev --root /path/to/your/project
```

Run the tests:

```bash
pnpm test                                     # unit and integration tests (Vitest)
pnpm exec playwright install chromium         # once
pnpm test:e2e                                 # end-to-end tests (Playwright)
```

## Documentation

- [Architecture](docs/architecture.md) — packages, data model, design decisions
- [Configuration](docs/configuration.md) — every option
- [Deployment](docs/deployment.md) — publishing the static site
- [Security model](docs/security.md) — threat model and limitations

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Scope

Skillarium explores and documents skills. It deliberately does not run skills or agents, evaluate skills, install or sync them, call an LLM, or require a hosted service.

## License

[MIT](LICENSE)
