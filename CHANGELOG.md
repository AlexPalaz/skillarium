# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Architecture view: hovering a node keeps it and everything one line away in
  focus and dims the rest.
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
- Architecture view: when only skills are shown, linked skills are arranged
  left to right along their links, in separate groups, and skills without
  links sit in a grid underneath, so lines no longer cross unrelated nodes.

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
