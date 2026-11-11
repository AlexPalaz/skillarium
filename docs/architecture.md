# Architecture

Skillarium is a small pipeline with one contract in the middle:

```text
 project on disk ──▶ core (scan → parse → index → graph) ──▶ catalog.json + published files ──▶ viewer
                                                                  ▲
                                             served live by `dev`, written to disk by `build`
```

The viewer never touches the filesystem. It fetches a catalog and file contents over HTTP from URLs relative to the site base. The development server and the static build expose **the same URLs**, so there is one viewer and it cannot tell the two apart (except for a `mode` flag that turns live reload on).

## Packages

| Package | Role | Published |
| --- | --- | --- |
| `packages/core` (`@skillarium/core`) | Data model, discovery, parsing, indexing, graph. No UI, no HTTP. | No — bundled into the CLI |
| `packages/web` (`@skillarium/web`) | React viewer. Imports only *types* from core. | No — its build ships inside the CLI |
| `packages/cli` (`skillarium`) | Commands, config loading, dev server, static build, preview server. | Yes |

The original plan listed separate `scanner`, `parser` and `graph` packages. They are modules of `core` instead (`scan.ts`, `parse.ts`, `graph.ts`, `indexer.ts`): each is a few hundred lines, they are always released together, and nothing consumes one without the others. Splitting them would add build and versioning overhead without a boundary anyone depends on. They stay separately testable and can be extracted later.

## Data model

Defined in [`packages/core/src/model.ts`](../packages/core/src/model.ts), which has no Node.js imports so the viewer can share the types.

- **`Catalog`** — everything the viewer needs: project info, the roots that were searched, `sources`, `skills`, the `graph`, and project-level diagnostics. Carries a `schemaVersion`.
- **`SkillDefinition`** — `id`, `name`, `description`, `sourcePath` (relative to the project root), the complete frontmatter as `metadata` (unknown fields preserved), the Markdown `content`, `resources`, and `diagnostics`.
- **`SkillResource`** — a supporting file: its path inside the skill, `kind` (`script`, `reference`, `asset`, `other` — by the spec's directory conventions), size, how it can be previewed, and the `url` its content is published at. No `url` means the content is not published (binary or too large).
- **`SkillDiagnostic`** — `severity`, a stable `code`, a message.
- **`SkillGraph`** — nodes (skills and files) and edges, each edge with a `kind` and the `evidence` it is grounded in.

The catalog contains no absolute paths, timestamps or machine-specific data, and everything is sorted, so identical input produces byte-identical output.

### Skill ids

A skill's id is the slug of its name. If two skills share a name (for example `skills/pdf` and `.claude/skills/pdf`), **both** get an id derived from their path (`skills-pdf`, `claude-skills-pdf`). Ids therefore do not depend on discovery order, and a URL keeps pointing at the same skill when another one is added.

## Pipeline

1. **Scan** (`scan.ts`) — walks each skill root, resolving symlinks and dropping anything hidden, ignored, unreadable, or resolving outside the root. A directory containing `SKILL.md` is a skill. Skills may be nested in grouping folders or inside other skills; a nested skill is indexed on its own and excluded from its parent's files. Skills are de-duplicated by real path, so overlapping roots and symlinks do not produce duplicates.
2. **Parse** (`parse.ts`) — splits frontmatter from body and validates it against the [specification](https://agentskills.io/specification). It never throws: a malformed file yields diagnostics and whatever content could be recovered. Only `name` and `description` are required, as in the spec.
3. **Index** (`indexer.ts`) — classifies each file (`resources.ts`), assigns ids, and builds two outputs: the `Catalog`, and an **allowlist** mapping each published URL to a file on disk. Nothing outside that allowlist is ever served or copied.
4. **Graph** (`graph.ts`) — a pure function from skills and their Markdown documents to nodes and edges.

### What counts as a relationship

| Edge | Grounded in |
| --- | --- |
| `contains` | The file is inside the skill's directory. |
| `references` | A Markdown document of the skill links to the file, or names its path relative to the skill root as a standalone token (the spec's convention, e.g. `scripts/extract.py`). |
| `links-to-skill` | A Markdown link resolves into another indexed skill's directory. |

There is no similarity analysis, no keyword matching between skills, and no LLM. A sentence like “works well with the PDF skill” creates no edge.

## Serving and building

The viewer is built once, with relative asset URLs. The CLI turns its `index.html` into a page for a concrete base path (`shell.ts`) by rewriting those URLs and injecting the base and a Content Security Policy.

- **`dev`** (`server.ts`) serves that shell for routes, `data/catalog.json` from memory, files from the allowlist, and a server-sent-events stream. A debounced `chokidar` watcher reindexes on change and notifies the viewer, which refetches the catalog. It also watches for skill roots that do not exist yet.
- **`build`** (`build.ts`) writes the same things to disk: one `index.html` **per route** (`/`, `/skills/`, `/skills/<id>/`, `/architecture/`, plus `404.html`), the catalog, and the allowlisted files.
- **`preview`** serves that directory strictly — files, directory indexes, `404.html`, nothing else — to behave like a real static host.

### Why a page per route

A single-page app with client-side routing needs the host to answer every unknown path with `index.html`. GitHub Pages and plain file servers do not. Generating a real file for every route makes direct links and refresh work everywhere, with no host configuration. File selection inside a skill uses a query string (`?file=scripts/run.py`), which needs no extra page.

### Why text files are published with a `.txt` suffix

A static host decides the content type from the file extension. If a skill's `page.html` or `icon.svg` were published under its own name, opening its URL would run its script on the site's origin. Every text file is therefore published as `<name>.txt`, and SVG is treated as text. Raster images are published as they are.

## Dependency choices

| Need | Choice | Why |
| --- | --- | --- |
| YAML | `yaml` | Maintained, spec-compliant, bounded alias expansion. |
| Ignore rules | `ignore` | Implements gitignore semantics. |
| CLI parsing | `cac` | Small; commands, options and help without a framework. |
| Config loading | `jiti` | Loads `.ts` config files on all supported Node versions. |
| File watching | `chokidar` | Reliable cross-platform watching. |
| HTTP | `node:http` | Two small servers; a framework would add nothing. |
| Viewer | React, Vite, Tailwind CSS, React Router | As proposed. Components are hand-written; shadcn/ui was not needed for a UI this size. |
| Fonts | `@fontsource-variable/host-grotesk`, `@fontsource-variable/jetbrains-mono` | Self-hosted, so nothing is fetched from a third party. |
| Markdown | `react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-slug` | Renders to React elements, never raw HTML. |
| Search | `minisearch` | Client-side lexical search with prefix and fuzzy matching, a few kilobytes. |
| Graph | `@xyflow/react` (React Flow) | Maintained; loaded only on the architecture page. |
| Graph layout | `@dagrejs/dagre` | Layered layout for groups of linked skills; loaded with the graph. |

No database, no authentication, no hosted service, no LLM.

## Visual system

The viewer's look is defined once, as tokens at the top of
[`packages/web/src/styles.css`](../packages/web/src/styles.css):

| | |
| --- | --- |
| Palette | Forest and lime: a dark green ground with a pale lime accent. This dark theme is the default, whatever the system setting; the reader's own choice is remembered. The light theme is its inverse — a white sheet with forest ink, the ink doubling as the action colour. |
| Type | Host Grotesk for text and headings (headings at weight 500, tight tracking), JetBrains Mono for code and paths. |
| Shape | Sharp radii (2 / 4 / 6 / 8 px), 1px hairlines at 13% of the ink, flat grounds. |
| Mark | A diamond above an open book, in the accent colour, beside the name: a skill rising from its page. The diamond stands for a skill; the favicon is the same drawing on the forest ground. |

Rules the components follow: the interface stays neutral and the accent is rare
(the mark, the current item, focus, explicit references in the graph); resource
kinds are the only other colours, and none of them is violet; labels are
sentence case at 13px, never tracked capitals; nothing is set smaller than
13px; every text colour is at least 4.5:1 on both grounds; hover and press
only move transforms, in 150 / 120 / 90 ms, and rest under
`prefers-reduced-motion`.

Both fonts are open source (SIL Open Font License 1.1) and are bundled with the
viewer through `@fontsource-variable/*`, so the site makes no request to a font
service and works offline. Assets are never inlined as `data:` URLs, which
keeps the Content Security Policy at `font-src 'self'`.

## Room to grow

Deliberately not built, but not blocked:

- **Multi-repository catalogs** — a `Catalog` is a self-contained JSON document with a schema version; several can be merged or listed side by side.
- **Other relationship analyses** — new edge kinds can be added to the graph without touching the viewer's layout, as long as each carries its evidence.
- **Other front ends** — anything that can read `catalog.json` (an editor extension, a CI report) can reuse `core`.
