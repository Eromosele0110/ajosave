# Running the database locally

Ajosave needs a PostgreSQL 15+ database and a Redis 7+ instance for local
development. This guide covers the fastest path to a working local DB, plus
the current state of migrations so you don't get stuck.

## 1. Start Postgres + Redis with Docker Compose

The repo ships a `docker-compose.yml` at the root with a `postgres` and a
`redis` service, both with healthchecks:

```bash
docker-compose up -d postgres redis
```

This starts:

- Postgres on `localhost:5432`, database `ajosave`, user/password `ajosave`/`ajosave`
- Redis on `localhost:6379`

Set your `.env.local` (copied from `.env.example`) to match:

```bash
DATABASE_URL=postgresql://ajosave:ajosave@localhost:5432/ajosave
REDIS_URL=redis://localhost:6379
```

Check both services are healthy:

```bash
docker-compose ps
```

If you'd rather run Postgres/Redis natively instead of via Docker, just point
`DATABASE_URL` / `REDIS_URL` at your local instances — nothing else in this
guide is Docker-specific.

## 2. Load the schema

The canonical schema (all tables, indexes, and constraints as of the last
snapshot) lives at [`docs/schema.sql`](./schema.sql). For local development,
the quickest way to get a usable database is to load it directly:

```bash
psql "$DATABASE_URL" -f docs/schema.sql
```

## 3. About `migrations/` — read this before you rely on it

The repo also has a `migrations/` directory (TypeScript files with `up`/`down`
exports) and [`docs/migrations.md`](./migrations.md) describing a
`node-pg-migrate`-based workflow (`npm run migrate`, automatic migration runs
in `instrumentation.ts` and the `Dockerfile`, a `migrate-ci` CI job). **As of
this writing that workflow does not actually work:**

- `node-pg-migrate` is not listed in `package.json` dependencies, even though
  `scripts/migrate.ts` and `instrumentation.ts` both import it.
- There is no `migrate` / `migrate:down` / `migrate:create` script in
  `package.json`, so `npm run migrate` (as documented) fails immediately.
- At least one migration (`migrations/1748600000000_add-payout-status.ts`)
  is written against the `kysely` query builder API instead of
  `node-pg-migrate`'s `MigrationBuilder`, and `kysely` is also not a
  dependency — so even a correctly wired runner would fail partway through
  the full migration set.
- `.github/workflows/ci.yml` has no `migrate-ci` (or similarly named) job.

This is a known, pre-existing gap (tracked separately, see PR #170) and is
out of scope for this doc to fix. Until it's resolved, `docs/schema.sql` (step
2 above) is the reliable way to get a local schema. If you're working on a
change that adds/alters a table, update `docs/schema.sql` by hand alongside
whatever migration file you add, so local setup keeps working for everyone
else.

## 4. Verify

```bash
psql "$DATABASE_URL" -c "\dt"
```

You should see `circles`, `members`, `contributions`, `payouts`, `users`,
and the other tables defined in `docs/schema.sql`.
