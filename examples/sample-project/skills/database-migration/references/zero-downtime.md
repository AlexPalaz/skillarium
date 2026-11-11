# Zero-downtime patterns

## Expand and contract

1. **Expand:** add the new structure next to the old one.
2. **Migrate:** backfill in batches, write to both.
3. **Contract:** remove the old structure in a later release.

## Lock awareness

| Statement                      | Lock                     | Safe on large tables? |
| ------------------------------ | ------------------------ | --------------------- |
| `ADD COLUMN` (no default)      | `ACCESS EXCLUSIVE`, brief | Yes                   |
| `CREATE INDEX`                 | Blocks writes            | No                    |
| `CREATE INDEX CONCURRENTLY`    | None blocking            | Yes                   |
| `ALTER COLUMN TYPE`            | Table rewrite            | No                    |

Always set `lock_timeout` before running DDL.
