# Contributing to Skillarium

Thanks for helping. Bug reports, fixes, documentation and focused features are
all welcome. By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs:** open an issue with steps to reproduce, or go straight to a pull
  request if the fix is small.
- **Features:** open an issue first. Skillarium is intentionally small; check
  the [scope](README.md#scope) and the non-goals below before investing time.
- **Security problems:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 20.19 or newer, and pnpm 9 (`corepack enable` installs
the version pinned in `package.json`).

```bash
pnpm install
pnpm build            # builds the viewer, then the CLI (which embeds the viewer)
pnpm dev:example      # run the CLI against examples/sample-project
```

## Project layout

```text
packages/core   discovery, parsing, indexing, graph — no UI, no HTTP
packages/web    the React viewer; talks to the CLI only through HTTP
packages/cli    the published `skillarium` package: commands, servers, build
examples/       a sample project, also used by the end-to-end tests
e2e/            Playwright tests and their fixtures
docs/           architecture, configuration, deployment, security
```

[docs/architecture.md](docs/architecture.md) explains how the pieces fit.

## Working on the viewer

The viewer needs data from a running CLI. In two terminals:

```bash
node packages/cli/bin/skillarium.js dev --root examples/sample-project --no-open   # data on :4400
pnpm --filter @skillarium/web dev                                                  # Vite with hot reload
```

The Vite dev server proxies data requests to port 4400 (override with
`SKILLARIUM_DEV_BACKEND`). Run `pnpm build` to see viewer changes through the
CLI itself.

## Checks

Run these before opening a pull request; CI runs the same ones.

```bash
pnpm typecheck
pnpm build
pnpm test                                # Vitest: unit and integration
pnpm exec playwright install chromium    # first time only
pnpm test:e2e                            # Playwright: user journeys
```

`pnpm test` and `pnpm test:e2e` exercise the built CLI and viewer, so run
`pnpm build` first.

## Guidelines

- **Tests protect behaviour.** Add a test for a bug you fix or a behaviour you
  add. Do not test implementation details.
- **Skills are untrusted input.** Any change that reads files, renders
  content, builds URLs, or serves data must preserve the guarantees in
  [docs/security.md](docs/security.md). Never execute skill content; never
  serve a path that is not in the indexer's allowlist.
- **Follow the specification.** Do not make fields mandatory that the
  [Agent Skills specification](https://agentskills.io/specification) leaves
  optional, and do not require changes to existing skills.
- **Relationships need evidence.** The architecture graph only shows
  filesystem facts and explicit references. Do not add inferred edges.
- **Keep the catalog deterministic and portable:** no absolute paths, no
  timestamps, stable ordering.
- **Keep it small.** Prefer no new dependency; justify the ones you add.
  Avoid abstractions that have a single use.
- TypeScript is in strict mode. Match the surrounding code style.

## Non-goals

Running skills or agents, skill evaluation, LLM-powered features, embeddings,
marketplaces, installation or synchronization of skills, authentication, and
hosted services are out of scope for now.

## Pull requests

- Keep each pull request to one topic.
- Describe what changed and why, and how you tested it.
- Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for
  user-visible changes.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
