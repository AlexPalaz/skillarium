---
name: database-migration
description: Plans and writes safe, reversible database schema migrations for PostgreSQL. Use when the user wants to add, change or remove tables, columns, indexes or constraints, or asks how to deploy a schema change without downtime.
compatibility: Requires psql and access to a PostgreSQL 13+ database
metadata:
  author: data-team
  version: "0.9"
  reviewed: "2026-09-30"
---

# Database Migration

Write migrations that can be deployed without downtime and rolled back without
data loss.

## Workflow

1. Inspect the current schema.
2. Draft the migration from `assets/migration-template.sql`.
3. Validate it: `bash scripts/check_migration.sh migrations/0042_add_index.sql`.
4. Check the [zero-downtime patterns](references/zero-downtime.md).
5. Write the matching `down` migration.

## Rules

- Never drop a column in the same release that stops writing to it.
- Create indexes with `CREATE INDEX CONCURRENTLY`.
- Add `NOT NULL` in two steps: add a `CHECK … NOT VALID`, then validate.

```sql
ALTER TABLE orders
  ADD CONSTRAINT orders_customer_id_not_null
  CHECK (customer_id IS NOT NULL) NOT VALID;

ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_id_not_null;
```

For reviewing the resulting change, see the
[code-review skill](../code-review/SKILL.md).
