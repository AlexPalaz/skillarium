# Deploying the static site

`skillarium build` writes a self-contained site to `./skillarium-dist`. It is plain files — HTML, CSS, JavaScript, JSON and your skills' published files — and needs no server-side code.

```bash
npx skillarium build
npx skillarium preview     # check it locally first
```

`preview` serves the directory the way a static host does: no rewrites and no single-page-app fallback. If it works there, it works on a static host.

> Before publishing, remember that **everything inside your skill folders becomes public**. See the limitations in [security.md](security.md#limitations).

## The base path

If the site is served from the root of a domain (`https://skills.example.com/`), the default base `/` is right.

If it is served from a sub-path (`https://acme.github.io/my-repo/`), build with that path:

```bash
npx skillarium build --base /my-repo/
```

or set `base: '/my-repo/'` in `skillarium.config.ts`. A wrong base shows up as a blank page with 404s for `/assets/...`.

## How routing works

Every route is a real file, so links and refresh work without host configuration:

```text
skillarium-dist/
├── index.html                  /
├── 404.html                    any unknown URL
├── skills/index.html           /skills/
├── skills/<id>/index.html      /skills/<id>/
├── architecture/index.html     /architecture/
├── data/catalog.json
├── files/<id>/...              published skill files
└── assets/                     the viewer
```

URLs end with a slash (`/skills/pdf/`). Hosts redirect the slash-less form on their own.

## GitHub Pages

Add a workflow such as `.github/workflows/skills-site.yml`:

```yaml
name: Publish skills site
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Project sites live at /<repository-name>/
      - run: npx skillarium build --base "/${{ github.event.repository.name }}/" --strict
      - uses: actions/upload-pages-artifact@v3
        with:
          path: skillarium-dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

In the repository settings, set **Pages → Source** to **GitHub Actions**. For a user/organization site or a custom domain, use `--base /`.

The build includes a `.nojekyll` file so GitHub Pages serves the output unprocessed.

## Cloudflare Pages

| Setting | Value |
| --- | --- |
| Build command | `npx skillarium build` |
| Build output directory | `skillarium-dist` |

## Netlify

```toml
# netlify.toml
[build]
  command = "npx skillarium build"
  publish = "skillarium-dist"
```

## Vercel

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Build command | `npx skillarium build` |
| Output directory | `skillarium-dist` |

## Any web server

Copy `skillarium-dist/` to the document root (or to a sub-directory matching `--base`). The server only needs to serve `index.html` for directories, which is the default almost everywhere. Optionally configure `404.html` as the not-found page.

```nginx
location /skills-docs/ {
  alias /var/www/skillarium-dist/;
  index index.html;
  error_page 404 /skills-docs/404.html;
}
```

## Build in CI

- `skillarium check` validates the skills without building anything: it exits 1 when a skill has an error (invalid frontmatter, a link to a file that does not exist, two different skills with the same name, …), or also for warnings with `--fail-on warning`. The checks are listed in [diagnostics.md](diagnostics.md). Run it on pull requests.
- `--strict` makes the build itself fail when a skill has an error, for the job that publishes the site.
- `skillarium list --json` gives a machine-readable inventory with diagnostics.
- Output is deterministic: the same skills produce byte-identical files, so a build can be diffed or cached.
