# Database Migrations

> **Setting up a local database?** See [docs/LOCAL_DATABASE.md](./LOCAL_DATABASE.md) first —
> the `npm run migrate` workflow described below is not currently wired up
> (missing `node-pg-migrate` dependency and package.json scripts); that doc
> explains the honest current state and the reliable local workaround.

Ajosave uses [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) for schema migrations.  
Migration files live in `migrations/` and are TypeScript files with `up` and `down` exports.

---

## Running Migrations

```bash
# Apply all pending migrations
npm run migrate

# Roll back the most recent migration
npm run migrate:down

# Create a new migration file
npm run migrate:create -- --name add-users-kyc-column
```

`DATABASE_URL` must be set in your environment (see `.env.example`).

---

## How Migrations Run Automatically

| Environment | Mechanism |
|-------------|-----------|
| Docker / self-hosted | `CMD` in `Dockerfile` runs `migrate up` before `next start` |
| Vercel | `instrumentation.ts` `register()` runs `migrate up` on first server boot (production only) |
| CI | `migrate-ci` job in `.github/workflows/ci.yml` runs `up` then `down` on every push |

---

## Rollback Procedure

`migrate:down` rolls back **one migration at a time** (the most recently applied).

### Step-by-step rollback in production

1. **Take a backup first** (see [docs/backup.md](./backup.md)):
   ```bash
   ./scripts/pg_backup.sh
   ```

2. Roll back one step:
   ```bash
   DATABASE_URL=<prod-url> npm run migrate:down
   ```

3. Verify the schema is in the expected state:
   ```bash
   psql $DATABASE_URL -c "SELECT id, name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 5;"
   ```

4. If multiple steps are needed, repeat step 2 until the desired version is reached.

5. Deploy the previous application version.

> **Never** run `migrate:down` in production without a backup. The `down` function for each migration is the authoritative rollback — keep it accurate when writing new migrations.

---

## Writing a New Migration

```bash
npm run migrate:create -- --name describe-your-change
# → migrations/<timestamp>_describe-your-change.ts
```

Every migration file must export both `up` and `down`:

```ts
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("users", {
    kyc_verified: { type: "boolean", notNull: true, default: false },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("users", "kyc_verified");
}
```

Rules:
- Always implement `down` — CI validates it on every PR.
- Never edit an already-applied migration; create a new one instead.
- Keep migrations small and focused on one change.

---

## Migration State

Applied migrations are tracked in the `pgmigrations` table:

```sql
SELECT id, name, run_on FROM pgmigrations ORDER BY run_on;
```
