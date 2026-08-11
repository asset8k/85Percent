# Database Workflow

`apps/admin/prisma/migrations` is the only incremental schema history for
85Percent. Apply it to a hosted environment with `prisma migrate deploy`; do
not use `prisma db push`, reset, or seed commands for schema deployment.

## Creating changes

1. Create a new migration in `apps/admin/prisma/migrations`.
2. Apply and test it in Development.
3. Promote the same committed migration to Production with `prisma migrate deploy`.

Once a migration may have been applied anywhere, never edit its SQL. Create a
new append-only migration, even for a `CREATE OR REPLACE FUNCTION` or policy
correction. Prisma records a checksum for each applied migration.

## Manual Supabase SQL

Manual SQL must be copied into an append-only Prisma migration before the next
deployment. The migration should be idempotent when repeating that SQL is safe.
Run `prisma migrate status` first. If it reports a checksum mismatch, stop:
do not use `migrate resolve` to conceal it. Compare the applied migration's
exact historical content, restore that immutable file if necessary, and add a
new reconciliation migration for the desired database state.

The migrations dated `20260811120000` and `20260811121000` formalize SQL that
was manually applied to the Auth-delete trigger and registration-asset RLS.
They can be deployed safely to environments already containing the final SQL.

## Deployment checks

Before and after each hosted migration deployment:

```sh
pnpm --filter @85percent/admin exec prisma migrate status
pnpm --filter @85percent/admin exec prisma migrate deploy
pnpm --filter @85percent/admin exec prisma migrate status
```

Use the environment-specific `DATABASE_URL` only for the intended target.
Never run migrations from the admin UI. Keep reference-data seeding separate
from migrations; `db:seed:templates:*` does not create schema objects.
