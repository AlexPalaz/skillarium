---
name: feature-cycle
description: The mandatory order of work for any feature in Skillarium - plan, then README and docs, then tests, then code. Use it every time a feature is added AND every time an existing feature is changed, extended, fixed or removed, however small the change. Triggers on "add a feature", "new feature", "change how X works", "modify", "fix", "aggiungi una feature", "nuova funzionalità", "modifica", "cambia", "sistema".
---

# Feature cycle

Every feature, and every later change to one, goes through the same four
steps in the same order. The code is written last, against what the README
and the tests already say.

```text
1. Plan  ->  user's go-ahead  ->  2. README and docs  ->  3. Tests  ->  4. Code
```

Nothing is edited before the user approves the plan. Do not write or edit
implementation code before steps 1 to 3 are done. If you
notice you have started coding early, stop, go back, and finish the earlier
steps first.

## 1. Plan

Write the plan in the conversation, not in a file. Keep it short:

- what the user will be able to do, in one or two sentences;
- the behaviour at the edges (empty input, malformed skill, large catalog);
- which packages are touched (`core`, `cli`, `web`) and which files;
- which documents and which tests will change;
- anything that touches the project's rules in `CONTRIBUTING.md`: skills are
  untrusted input, only allowlisted files are served, the catalog stays
  deterministic, graph edges need evidence, no new dependency without a reason.

Then stop and wait. Present the plan, ask for the go-ahead, and end the turn:
do not touch the README, the tests or the code until the user has said yes.
Reading the code to prepare the plan is fine; editing anything is not.

- Put the choices you made on the user's behalf in the plan, so they can be
  corrected before any work exists.
- If the user answers with changes, revise the plan and ask again. Only an
  explicit approval of the current plan starts step 2.
- An approval covers that plan only. A different feature, or a change that
  goes beyond what was approved, needs its own plan and its own yes.

## 2. README and docs

Describe the feature as if it already existed. This text is the specification
for the next two steps.

- `README.md`: the feature list, usage, the commands table, whatever a user
  reads first.
- `docs/`: the page that owns the topic (`configuration.md` for options and
  flags, `architecture.md` for the model and pipeline, `security.md` for
  anything that reads, serves or renders skill content, `deployment.md`).
- `CHANGELOG.md`: an entry under `Unreleased`.

Write only what will be true. If a change has no effect a user can see (a
refactor, an internal fix), say so in one line and add nothing to the README;
the CHANGELOG entry is skipped as well.

## 3. Tests

Write the tests from the README text, not from an implementation idea.

- Unit and integration tests: `packages/<package>/test/*.test.ts` (Vitest).
- User journeys in the browser: `e2e/*.spec.ts` (Playwright).
- Test behaviour, not implementation details. One test per statement the
  docs make, plus the edges listed in the plan.

Run the new tests and confirm they fail for the right reason: the feature is
missing, not a typo or a bad import. `packages/cli` tests and the end-to-end
tests run the built CLI and viewer, so they cannot fail meaningfully until the
build; check those by reading them and run them in step 4.

```bash
pnpm exec vitest run packages/core/test/<file>.test.ts
```

## 4. Code

Now implement, until the tests from step 3 pass without being weakened. If a
test turns out to be wrong, go back: fix the README first if the described
behaviour was wrong, then the test, then continue.

Finish with the project's checks, in this order:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e      # when the viewer or a server changed
```

Report what ran and what it printed. A step that was not run is reported as
not run.

## Changing an existing feature

A change is not a shortcut. Go around again:

1. **Plan** the change: what is different from today. Wait for the user's
   go-ahead, as for a new feature.
2. **README and docs**: edit the existing text so it describes the new
   behaviour, and remove what is no longer true. Update the `Unreleased`
   entry in `CHANGELOG.md`, or add one under `Changed` or `Fixed`.
3. **Tests**: change the existing tests to match the new text and add the
   ones that are missing. For a bug, first write the test that reproduces it
   and see it fail.
4. **Code**: only now touch the implementation.

This applies to every change to the feature's behaviour, including the ones
requested in the middle of building it. A change that arrives during step 4
sends the work back to step 2.

## Closing check

Before saying the work is done, confirm each of these and state it:

- the user approved the plan before anything was edited;
- the README and docs describe exactly what the code now does;
- every statement added to the docs has a test;
- the tests were written before the code and were seen failing, or it is said
  which ones could not be run before the build;
- typecheck, build and tests pass.
