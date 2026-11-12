# Configuration

Skillarium works without configuration. Add a config file only to change a default.

## Config file

Skillarium looks in the project root for, in order: `skillarium.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs`, `.json`. Use `--config <file>` to point at another file.

```ts
// skillarium.config.ts
import { defineConfig } from 'skillarium';

export default defineConfig({
  title: 'Engineering Agent Skills',
  skills: ['./skills', './.agents/skills'],
});
```

`defineConfig` only provides types and editor completion. The import works even when `skillarium` is run through `npx` and is not installed in the project.

> A `.ts`/`.js` config file is executed when Skillarium starts. Treat it as project code, like `vite.config.ts`. A `.json` config is only parsed.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | Project directory name | Name shown in the viewer and page titles. |
| `description` | `string` | — | Shown on the overview page and in the meta description. |
| `skills` | `string[]` | Well-known locations (below) | Directories to scan, relative to the project root. Each is searched recursively for folders containing `SKILL.md`. A directory that itself contains `SKILL.md` is a skill. **Setting this replaces the defaults.** |
| `ignore` | `string[]` | `[]` | Extra ignore patterns in gitignore syntax, relative to the project root. |
| `outDir` | `string` | `./skillarium-dist` | Output directory of `skillarium build`. |
| `base` | `string` | `/` | Public path the static site is served from, e.g. `/my-repo/`. |
| `repository` | `string` | — | Repository URL; adds a link to the top navigation. |
| `sourceUrl` | `string` | — | Template for “view source” links. `{path}` is replaced by the file's path relative to the project root, e.g. `https://github.com/acme/skills/blob/main/{path}`. |
| `port` | `number` | `4400` | Port of the development server. |

Unknown options are rejected with an error, so typos do not pass silently.

### Default skill locations

```text
.agents/skills   .claude/skills   .codex/skills   .cursor/skills
.gemini/skills   .github/skills   .opencode/skills   skills
```

### When the default locations hold no skill

If `skills` is not set and no skill is found in the default locations, the whole project is searched for folders that contain a `SKILL.md`, with the same rules and one more:

- hidden folders, `node_modules` and whatever `.skillariumignore` and `ignore` exclude are skipped, as everywhere;
- folders excluded by the `.gitignore` in the project root are skipped too, so that skills inside build output or downloaded dependencies are not picked up. Only that one file is read, not `.gitignore` files in subfolders, and it only limits where skills are looked for: the files of a skill that was found are listed as usual;
- a `SKILL.md` in the project root makes the project itself a skill.

The catalog then carries the note `searched-whole-project`, shown in the viewer and by `skillarium list`.

This is a fallback, not a second pass: as soon as one skill is found in a default location, nothing else is searched. A project with skills both in `skills/` and somewhere else needs `skills: ['skills', 'somewhere/else']`. Setting `skills` always turns the fallback off.

`skillarium dev` watches the skills that were found and the top level of the project. A skill added later in a new folder further down appears after a restart.

## Command-line overrides

Flags take precedence over the config file.

| Flag | Commands | Overrides |
| --- | --- | --- |
| `--root <dir>` | all | The project to scan (default: current directory). |
| `--config <file>` | all | Which config file to load. |
| `--port <port>` | `dev`, `preview` | `port`. If the port is given explicitly and is busy, the command fails; otherwise the next free port is used. |
| `--host <host>` | `dev`, `preview` | Bind address (default `127.0.0.1`). |
| `--no-open` | `dev` | Do not open the browser. It is also not opened in CI or when output is not a terminal. |
| `--out-dir <dir>` | `build`, `preview` | `outDir`. |
| `--base <path>` | `build`, `preview` | `base`. `preview` defaults to the base the site was built with. |
| `--strict` | `build` | Exit with code 1 if any skill has an error diagnostic. |
| `--fail-on <severity>` | `check` | `error` (default): exit 1 when there is an error. `warning`: exit 1 for warnings too. Any other value is a usage error. |
| `--json` | `list`, `inspect`, `check` | Machine-readable output. |

### `check --json`

```json
{
  "ok": false,
  "skills": 2,
  "errors": 1,
  "warnings": 1,
  "diagnostics": [
    {
      "severity": "error",
      "code": "missing-frontmatter",
      "message": "SKILL.md does not start with a YAML frontmatter block (--- … ---).",
      "skill": "bad",
      "path": "skills/bad",
      "file": "SKILL.md"
    }
  ]
}
```

`ok` is what the exit code reports: `true` for 0, `false` for 1. `diagnostics` lists errors and warnings only, project-level ones first, then skill by skill in catalog order. `skill` is the skill's id, `path` its directory relative to the project root and `file` the file inside it. A problem that belongs to the project rather than to one skill (a configured root that does not exist, a symlink that was skipped) has no `skill` and no `file`, and `path` is the place it was found. The output is the same on every run for the same project.

## Ignoring files

Create `.skillariumignore` in the project root. It uses gitignore syntax, relative to the project root:

```gitignore
# a whole skill
skills/experimental/

# a file type inside every skill
*.bak
```

Always skipped, without configuration: hidden files and directories (names starting with `.`) inside skill roots, `node_modules`, symlinks that leave their skill root, and files that look like keys or certificates.

`.gitignore` is intentionally **not** applied: skill folders such as `.claude/` are often git-ignored, and you still want to browse them locally.

## Limits

| Limit | Value |
| --- | --- |
| `SKILL.md` size | 1 MB |
| Text file preview | 512 KB |
| Image preview | 5 MB |
| Files indexed per skill | 500 |

Files above the preview limits are listed with their size, but their content is not published.
