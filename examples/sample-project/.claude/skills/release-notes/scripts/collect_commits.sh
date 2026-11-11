#!/usr/bin/env bash
# Print one line per commit since the given tag.
set -euo pipefail

since="${1:?usage: collect_commits.sh <tag>}"
git log "${since}..HEAD" --no-merges --pretty='format:%h %s (%an)'
