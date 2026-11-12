# Security model

Skillarium reads skills written by other people and shows them in a browser. It treats **every skill as untrusted input**: its Markdown, its metadata, its file names, its files, and its symlinks.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Trust boundaries

| Input | Trust | Notes |
| --- | --- | --- |
| Skill content (`SKILL.md`, frontmatter, every supporting file) | **Untrusted** | Parsed and displayed. Never executed, never obeyed. |
| `skillarium.config.ts` / `.js` | **Trusted project code** | It is executed when Skillarium starts, exactly like `vite.config.ts` or an npm script. Only run Skillarium with a config file you would be willing to run. A `.json` config is parsed, not executed. |
| `.skillariumignore`, CLI flags | Trusted | Supplied by the person running the tool. |

Instructions found inside a skill (“ignore previous instructions”, “run this script”) are text to display. Skillarium contains no agent and no LLM, so there is nothing for them to steer.

## What Skillarium guarantees

**No execution.** Scripts are read as text. Nothing in a skill is run, imported, or evaluated, during discovery or afterwards.

**Reads stay inside the skill roots.**

- Only the skill roots are walked: the folders listed under `skills`, or the default locations. The rest of the project is not read, with one exception: when `skills` is not set and the default locations hold no skill, the whole project is searched for `SKILL.md` files, under the rules below and leaving out what the root `.gitignore` excludes. Only the folders in which a `SKILL.md` is found are then indexed.
- Symbolic links are resolved, and any link whose target is outside its skill root is skipped and reported. Link cycles are detected.
- Hidden files and directories (`.env`, `.git`, …) and `node_modules` are skipped.
- Files that look like keys or certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa`, …) are excluded.

**Only indexed files are served or copied.** The indexer produces an allowlist of published URLs. The development server answers file requests *only* from that allowlist — there is no route that maps a URL to a path on disk — and re-checks at request time that the file still resolves inside its root. The static build copies only allowlisted files.

**Skill content cannot script the viewer.**

- Markdown is rendered to React elements. Raw HTML in Markdown (`<script>`, `<iframe>`, `<img onerror>`, …) is dropped, not rendered.
- Links are limited to `http:`, `https:`, `mailto:`, in-page anchors, and relative links that resolve to an indexed file. `javascript:`, `data:`, `file:` and other schemes become inert text. External links open with `rel="noopener noreferrer nofollow"`.
- Remote images are never loaded; a notice is shown instead. Only images that are indexed files of the skill are displayed. This also means opening a skill does not notify a third-party server.
- Every text file — including `.html` and `.svg` — is published with a `.txt` suffix and served as `text/plain` with `X-Content-Type-Options: nosniff`, so opening its URL shows source instead of running it. SVG is previewed as source.
- Pages carry a Content Security Policy (`script-src 'self'`, `connect-src 'self'`, `object-src 'none'`, …) as defence in depth, as an HTTP header in `dev` and a `<meta>` tag in static builds.
- Skill names and descriptions written into generated HTML (`<title>`, meta description) are escaped.

**Skill content cannot issue workflow commands.** In GitHub Actions, a line of output that starts with `::` is a command to the runner. The annotations `check` prints there carry file names and messages taken from skills, so `%`, carriage returns and line feeds are encoded in them, and `:` and `,` as well in file names and titles. A file name that contains a line break can therefore not start a command of its own. For the same reason every diagnostic and every file name is printed on one line on the command line: a line break inside a message or a path is shown as `\n`.

**Bounded resource use.** `SKILL.md` larger than 1 MB is not loaded; text files over 512 KB and images over 5 MB are listed but not published; at most 500 files are indexed per skill; directory depth is capped; YAML alias expansion is limited.

**The development server is local.** It binds to `127.0.0.1`, accepts only `GET` and `HEAD`, and rejects requests whose `Host` header is not a loopback name, which blocks DNS-rebinding attacks from web pages. Binding to another address with `--host` is an explicit choice and prints a warning.

**Builds contain only what was indexed.** A static build holds the viewer, the catalog, and the allowlisted files. It contains no absolute local paths, no environment variables, and nothing from outside the skill roots. `skillarium build` refuses to empty a non-empty directory it did not create.

These properties are covered by automated tests (`packages/core/test`, `packages/cli/test`, `e2e/dev-server.spec.ts`).

## Limitations

Know these before publishing a site:

- **Everything inside a skill folder is published.** Skillarium cannot tell a secret from documentation. An API token pasted into a `SKILL.md`, or a credentials file with an unremarkable name, will appear in the catalog and the static site. The key-file exclusion is a name-based safety net, not secret scanning. Review what is in your skill folders before you publish, and use `.skillariumignore` for anything that must stay out.
- **A published site is public documentation.** Anyone who can reach it can read every indexed skill, script and reference.
- **External links are shown.** A skill can link to a malicious website; Skillarium marks external links and opens them in a new tab, but cannot vet their destinations.
- **Content is displayed, not judged.** Skillarium does not detect prompt injection, malicious scripts, or misleading instructions inside a skill. Seeing a skill in Skillarium says nothing about whether it is safe to give to an agent.
- **The `<meta>` Content Security Policy of static builds cannot set `frame-ancestors`.** If clickjacking matters for your deployment, configure that header on your host.
- **`style-src` allows inline styles**, which the graph library needs for positioning. Inline scripts remain blocked.
- **Config files run code.** See the trust table above.
- **The size and count limits are fixed** and not yet configurable.
