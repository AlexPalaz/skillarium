#!/usr/bin/env bash
# Static checks for a migration file. Does not connect to a database.
set -euo pipefail

file="${1:?usage: check_migration.sh <migration.sql>}"
status=0

if grep -Eiq 'CREATE +INDEX' "$file" && ! grep -Eiq 'CONCURRENTLY' "$file"; then
  echo "warning: index created without CONCURRENTLY" >&2
  status=1
fi

if grep -Eiq 'DROP +(TABLE|COLUMN)' "$file"; then
  echo "warning: destructive statement found; confirm a backup exists" >&2
  status=1
fi

exit "$status"
