---
name: code-review
description: Reviews a diff or pull request for correctness, security and maintainability issues and reports prioritized findings. Use when the user asks for a review, a second opinion on a change, or feedback before merging.
metadata:
  author: acme-platform
  version: "2.0"
allowed-tools: Bash(git:*) Read Grep
---

# Code Review

Give a focused, prioritized review. Find real problems; skip style nitpicks a
formatter would catch.

## Process

1. Read the full diff: `git diff main...HEAD`.
2. Understand the intent before judging the implementation.
3. Walk through the [review checklist](references/checklist.md).
4. Rate every finding with the scale in `references/severity.md`.

## Output format

```markdown
### [high] Unvalidated redirect in `login.ts:42`

**Why it matters:** an attacker can send users to a phishing page.
**Suggested fix:** allow only relative paths.
```

## Principles

- **Evidence over opinion.** Quote the line and explain the failure scenario.
- **One finding, one fix.** Do not bundle unrelated remarks.
- **Say when it is good.** If nothing is wrong, say so plainly.
