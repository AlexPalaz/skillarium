# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Architecture view: hovering a node keeps it, everything one line away and
  the whole chain of skill links through it in focus, and dims the rest.
- Architecture view: a filter box narrows the graph to the skills whose name
  or file paths contain the typed words; the view follows the result.
- Architecture view: above 100 nodes only the nodes on screen are rendered.
- Architecture view: the help note can be put away as an icon; the choice is
  remembered.
- Buttons, including folder and group toggles, show a pointer cursor.
- `broken-link` warning: a relative Markdown link or image in a skill that
  leads to no file is reported on the skill, in the viewer and on the command
  line. Links inside code, links with a scheme and links that leave the
  project are not checked.
- Sidebar: when a catalog has skills with errors or warnings, buttons show
  only those skills (All / Errors / Warnings); the choice also narrows search
  results.
- `scripts/make-playground.mjs` (`pnpm playground`): generates a large,
  deterministic project for trying Skillarium at scale.

### Changed

- Frontmatter that is invalid YAML only because a plain value contains `: `
  or ` #` is now read line by line and reported as a warning
  (`lenient-yaml`) instead of an error, as agent tools accept it.
- YAML error messages give the line number in `SKILL.md`, not inside the
  frontmatter block.
- Architecture view: the layout widens with the size of the catalog, and
  above 30 skills it opens with files hidden.
- Architecture view: when only skills are shown, and in large catalogs also
  with files shown, linked skills are arranged left to right along their
  links, in separate groups, and skills without links sit underneath, so
  lines no longer cross unrelated nodes. In large catalogs a skill's files
  are listed under it, like a folder.

## [0.1.0] - 2026-11-11

Initial version. Not yet published to npm.

### Added

- Automatic discovery of Agent Skills in well-known and configured locations,
  with nested skills, de-duplication, ignore rules and safe symlink handling.
- `SKILL.md` parsing and validation against the Agent Skills specification,
  reported as diagnostics; malformed skills remain visible.
- Viewer: skill explorer, metadata, rendered GitHub-flavored Markdown with
  syntax highlighting and a table of contents, resource browser with file
  previews, client-side full-text search, dark (default) and light themes, responsive
  layout.
- Architecture view: a graph of skills and files limited to filesystem
  containment and explicit references.
- A visual system of its own: forest and lime palette, Host Grotesk and
  JetBrains Mono (bundled, no font service), sharp radii.
- `skillarium dev` with file watching and live reload.
- `skillarium build` static site generation with a page per route and
  configurable base path; `skillarium preview` to serve it.
- `skillarium list` and `skillarium inspect`, with `--json`.
- Optional typed configuration (`skillarium.config.ts`) and
  `.skillariumignore`.
