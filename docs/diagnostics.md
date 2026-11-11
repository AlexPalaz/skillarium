# Diagnostics

Skillarium reports what it finds wrong with a skill as **diagnostics**. They
appear on the skill's page and on the overview in the viewer, in
`skillarium inspect`, and in `skillarium check`, which turns them into an exit
code for CI.

A skill with diagnostics is still indexed and shown, so it can be fixed.

## Severities

| Severity | Meaning | `check` | `build --strict` |
| --- | --- | --- | --- |
| **error** | The skill will not work as written: it breaks the [specification](https://agentskills.io/specification), sends its reader to a file that is not there, or shares its name with a different skill. | exit 1 | exit 1 |
| **warning** | Probably a mistake, but found by a rule that can be wrong, or a matter of quality. | exit 0, or 1 with `--fail-on warning` | exit 0 |
| **note** | Something Skillarium did that you may want to know. | not printed | not printed |

The rule behind the split: a diagnostic is an error only when it is a fact.
Anything that rests on a guess about what the author meant is a warning, so
that a correct skill is never blocked.

## Links and files

These are the checks that matter most for skills written by an agent, which
tends to name files it never created and create files it never names.

### `broken-link` — error

A Markdown link or image in `SKILL.md`, or in a Markdown file of the skill,
leads to a file that does not exist.

```markdown
Read [the guide](references/guide.md) first.   <!-- no such file -->
```

A link is fine when it reaches a file of the skill, another skill, or anything
else that exists inside the project. It is resolved from the document that
contains it and, failing that, from each folder above the document up to the
skill's own, so a skill made of self-contained parts
(`references/forms/references/fields.md`) can write its paths from the part's
folder.

Not checked: links with a scheme (`https:`, `mailto:`), anchors, absolute
paths, links inside code, links that leave the project, and targets that are
not written like a file — no `/` and no extension — such as the placeholder in
`[Source](URL)`.

**Fix:** create the file, or correct or remove the link.

### `missing-path` — warning

A Markdown document of the skill names a file under `scripts/` or
`references/` that does not exist, without linking to it.

```markdown
Run `python scripts/extract.py input.pdf`.     <!-- no such script -->
```

A path in running text or in a code example is not always a claim that the
file is there — it may belong to another skill, or be an example — so this is
a warning. Only paths that end in a file name with an extension are checked;
folders, patterns (`scripts/*.py`) and placeholders (`scripts/<name>.py`) are
not. Paths under `assets/` are left alone: they are most often files the skill
produces, or files of the project it works on. A path that is also a broken
link is reported once, as `broken-link`. Paths are looked for from the skill's
folder and from each folder above the document. A path that exists in another
skill of the project is taken to mean that skill's file, and is not reported.

**Fix:** create the file or correct the path. If the path is an example, or a
file of the project the skill works on, the warning can be left.

### `orphan-file` — warning

A document or a script is in the skill's folder but cannot be reached from
`SKILL.md`: neither `SKILL.md` nor any file it leads to links to it or names
it. An agent starts from `SKILL.md` and follows references, so it will not
find this file.

Checked are the files an author writes for the agent to use:

- Markdown documents, wherever they are;
- files directly inside `scripts/`, `references/` and `assets/`.

Everything else — data, schemas and fonts in deeper folders, helper modules —
is plumbing that scripts load in their own ways, and is not reported. Neither
are `LICENSE`, `NOTICE`, `README` and `CHANGELOG` files, test files (`*.test.*`, `*.spec.*`,
`test_*.py`, `*_test.py`) and `__init__.py`.

A file counts as reached when a document or a script that is itself reached
links to it, names its path, or names its file name (`template.json`); a
script also reaches a module it names without the extension (`import
helpers`). A link to a folder, or a folder named with a trailing slash
(`references/forms/`), reaches every file in that folder: an agent sent to a
folder lists it. At most ten files are listed per skill, followed by a count
of the rest.

**Fix:** mention the file where the agent should use it, or delete it.

### `duplicate-name` — error

Two or more skills have the same `name` and are not copies of each other.

Keeping one skill in several agent folders (`.claude/skills/pdf` and
`.agents/skills/pdf`) is common and is not reported **as long as the copies
are identical**: same `SKILL.md`, same files, same contents. Once they differ,
which one an agent loads depends on the agent, and the copies have drifted
apart. Every skill involved gets the error, with the location of the others.

**Fix:** make the copies identical again (or replace them with a symbolic
link, which Skillarium indexes once), or rename one.

## Frontmatter

| Code | Severity | Meaning |
| --- | --- | --- |
| `missing-frontmatter` | error | `SKILL.md` does not start with a `---` block. |
| `invalid-yaml` | error | The frontmatter is not valid YAML. The message gives the line. |
| `invalid-frontmatter` | error | The frontmatter is valid YAML but not a mapping of keys to values. |
| `lenient-yaml` | warning | The frontmatter is invalid YAML only because a plain value contains `: ` or ` #`. It was read line by line, as agent tools do. Quote the value. |
| `missing-name` | error | The required `name` is missing or empty. |
| `invalid-name` | warning | `name` is not 1–64 lowercase letters, digits and single hyphens. |
| `name-mismatch` | warning | `name` differs from the name of the skill's folder. |
| `missing-description` | error | The required `description` is missing or empty. |
| `description-too-long` | warning | `description` is longer than 1024 characters. |
| `invalid-compatibility` | warning | `compatibility` is not a non-empty string. |
| `compatibility-too-long` | warning | `compatibility` is longer than 500 characters. |
| `invalid-metadata` | warning | `metadata` is not a mapping. |

When the frontmatter cannot be read at all, the checks on its fields are
skipped: one error is reported, not five.

## Reading the skill

| Code | Severity | Meaning |
| --- | --- | --- |
| `unreadable-skill-file` | error | `SKILL.md` could not be read. |
| `skill-file-too-large` | error | `SKILL.md` is larger than 1 MB and was not loaded. |
| `too-many-files` | warning | Only the first 500 files of the skill were indexed. |
| `secret-files-excluded` | note | Files that look like keys or credentials were left out. |

## The project

These are not attached to one skill. `check` lists them first.

| Code | Severity | Meaning |
| --- | --- | --- |
| `root-not-found` | warning | A folder listed under `skills` in the configuration does not exist. |
| `symlink-escape` | warning | A symbolic link points outside its skill root and was skipped. |
| `unreadable-directory` | warning | A folder could not be read. |
| `unreadable-entry` | warning | A file or folder could not be accessed. |

## Leaving something out

There is no way to silence a single diagnostic yet. To keep a file or a whole
skill out of Skillarium, and therefore out of every check, list it in
`.skillariumignore` (see [configuration](configuration.md#ignoring-files)).
