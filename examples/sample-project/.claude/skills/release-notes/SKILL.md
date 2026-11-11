---
name: release-notes
description: Drafts user-facing release notes from the commits and merged pull requests since the last tag. Use when preparing a release, writing a changelog entry, or summarizing what changed between two versions.
metadata:
  author: acme-platform
---

# Release Notes

Turn commit history into notes a user actually wants to read.

## Steps

1. Collect the changes: `bash scripts/collect_commits.sh v1.4.0`.
2. Group them: **Added**, **Changed**, **Fixed**, **Removed**.
3. Rewrite each item from the user's point of view.
4. Fill in `assets/template.md`.

## Style

- Lead with the benefit, not the implementation.
- Link issues, not commits.
- Call out breaking changes at the top.
