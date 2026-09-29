# Deployment Approval & Rollback

## Approval gate (one-time admin setup required)

`.github/workflows/production-deploy.yml` and
`.github/workflows/production-rollback.yml` both run under the
`production` GitHub Environment. As of this writing that environment
exists (it's already used by `backup.yml`/`restore-drill.yml`) but has
**no protection rules**, so the workflows will currently run
unattended. To actually get an approval gate, a repo admin needs to do,
once, in **Settings → Environments → production**:

1. Enable **Required reviewers** and add the people who should approve a
   production deploy or rollback.
2. Optionally restrict **Deployment branches** to `main` and release tags.

This is a repository setting, not something a workflow file can turn on —
this repo/fork does not have admin rights on `joekeyz8/ajosave` to do it
directly, hence documenting it here rather than silently shipping an
unenforced "gate."

Once configured, any run of `production-deploy.yml` or
`production-rollback.yml` will pause in "Waiting" state until a required
reviewer approves it from the Actions run page.

## Rollback path

`production-rollback.yml` (workflow_dispatch):

- With no input, it looks up the two most recent **successful** GitHub
  Deployments recorded against the `production` environment (recorded by
  `production-deploy.yml`/itself via the Deployments API) and redeploys the
  commit before the current one.
- With `to_sha` given explicitly, it checks out and redeploys that commit
  instead — use this to jump further back than one release.

Both the forward deploy and the rollback build the app from the target
commit and push it to Vercel with `--prod`, so a rollback is really "deploy
the old commit again," which is the reliable option here since we do not
have a separate artifact registry of built bundles.

### Contract caveat

If a production incident involves the Soroban contract itself (not just
the Next.js app), rolling back the app deployment does **not** roll back
on-chain contract state or a bad contract upgrade — Soroban contracts are
immutable once deployed except via their own upgrade mechanism. Rolling
back the app to point at a previously-known-good `STELLAR_AJO_CONTRACT_ID`
is a separate, manual decision and is out of scope for this workflow.
