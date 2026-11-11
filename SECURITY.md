# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (**Security → Report a vulnerability**).

Include what you can of:

- the affected version or commit,
- a description of the issue and its impact,
- steps or a minimal skill folder that reproduces it.

You should receive an acknowledgement within a week. Please allow time for a
fix to be released before disclosing the issue publicly.

## Scope

Skillarium displays untrusted skill content. Reports of particular interest:

- skill content (Markdown, frontmatter, file names, files, symlinks) that
  executes script in the viewer or makes it contact another origin;
- reading or serving files outside the configured skill roots, through the
  development server, the preview server, or the static build;
- local paths, environment variables or unrelated project files ending up in
  a static build;
- the development server being reachable or readable from another origin.

The intended guarantees and the known limitations are described in
[docs/security.md](docs/security.md). Behaviour listed there as a limitation
(for example: everything inside a skill folder is published) is by design.

## Supported versions

Skillarium is pre-1.0. Security fixes are made on the latest release only.
