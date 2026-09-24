# Contributing to Ajosave (STELLAR)

Thank you for your interest in contributing to Ajosave! This guide explains
everything you need to go from zero to a merged pull request, covering the
full contributor workflow, naming conventions, testing requirements, smart
contract changes, and common pitfalls.

---

## Table of contents

1. [Code of conduct](#code-of-conduct)
2. [Prerequisites](#prerequisites)
3. [Fork and clone](#fork-and-clone)
4. [Local development setup](#local-development-setup)
5. [Branch strategy](#branch-strategy)
6. [Making changes](#making-changes)
7. [Commit conventions](#commit-conventions)
8. [Testing requirements](#testing-requirements)
9. [Smart contract changes](#smart-contract-changes)
10. [Opening a pull request](#opening-a-pull-request)
11. [Code review process](#code-review-process)
12. [CI checks explained](#ci-checks-explained)
13. [Reporting issues](#reporting-issues)
14. [Security disclosures](#security-disclosures)

---

## Code of conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
Respectful, constructive communication is required in all project spaces.

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20 | Use `nvm` or `fnm` for version management |
| npm | 10 | Bundled with Node 20 |
| Git | 2.38+ | For `--no-verify` flag support |
| Rust + Cargo | stable | Only needed for contract changes |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) | latest | Only needed for contract deployment |
| PostgreSQL | 15+ | Required for integration tests |
| Redis | 7+ | Required for session/rate-limit tests |

---

## Fork and clone

**You are a contributor, not a maintainer.** All changes go through a fork → branch → PR workflow targeting the upstream `main` branch.

```bash
# 1. Fork the repo on GitHub (button top-right on the repo page)
# 2. Clone your fork
git clone https://github.com/<YOUR_USERNAME>/ajosave.git
cd ajosave

# 3. Add the upstream remote
git remote add upstream https://github.com/joekeyz8/ajosave.git

# Verify
git remote -v
# origin    https://github.com/<YOUR_USERNAME>/ajosave.git (fetch)
# origin    https://github.com/<YOUR_USERNAME>/ajosave.git (push)
# upstream  https://github.com/joekeyz8/ajosave.git (fetch)
# upstream  https://github.com/joekeyz8/ajosave.git (push)
```

---

## Local development setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
# Fill in the required values (see .env.example for descriptions)

# Start the dev server
npm run dev
# → http://localhost:3000

# (Optional) Start required services via Docker
docker-compose up -d
```

### Environment variables

All required variables are documented in `.env.example`. For local development
you need at minimum:

| Variable | Where to get it |
|---|---|
| `NEXTAUTH_SECRET` | Any random 32-char string: `openssl rand -hex 32` |
| `DATABASE_URL` | Local Postgres connection string |
| `REDIS_URL` | Local Redis connection string |
| `STELLAR_NETWORK` | `testnet` for local development |
| `STELLAR_SERVER_SECRET_KEY` | [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) — generate a testnet keypair |
| `PAYSTACK_SECRET_KEY` | Use a Paystack test key (`sk_test_...`) |
| `TERMII_API_KEY` | Use a Termii sandbox key |

**Never commit real credentials.** The repo runs `gitleaks` on every push.

---

## Branch strategy

Always branch from a **synced** copy of `upstream/main`:

```bash
# Sync your fork first
git fetch upstream
git checkout main
git merge upstream/main
git push origin main

# Create your feature branch
git checkout -b <type>/issue-<number>-<short-description>
```

### Branch naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/issue-<N>-<slug>` | `feat/issue-42-member-kick` |
| Bug fix | `fix/issue-<N>-<slug>` | `fix/issue-17-payout-overflow` |
| Docs | `docs/issue-<N>-<slug>` | `docs/issue-80-contributor-guide` |
| Refactor | `refactor/issue-<N>-<slug>` | `refactor/issue-55-db-layer` |
| Testing | `test/issue-<N>-<slug>` or `feat/issue-<N>-<slug>` | `feat/issue-90-realtime-suite` |
| Chore / CI | `chore/<slug>` | `chore/update-dependencies` |

One branch per issue. Do not combine unrelated changes.

---

## Making changes

1. **Read the issue** — understand the acceptance criteria before writing any code.
2. **Read the existing code** — match the project's style and patterns; don't introduce new frameworks.
3. **Keep changes focused** — fix one thing at a time. A reviewer should be able to understand the diff in one sitting.
4. **Write tests first** (or alongside) — see [Testing requirements](#testing-requirements).

### Key directories

```
src/app/              Next.js App Router pages and API routes
src/server/services/  Business logic (circle, payout, scheduler, etc.)
src/lib/              Shared utilities (db, stellar, email, SMS, etc.)
src/components/       React components
src/types/            TypeScript types and Zod schemas
contracts/ajo/        Soroban smart contract (Rust)
e2e/                  Playwright end-to-end and visual regression tests
src/__tests__/        Jest unit and integration tests
.github/workflows/    CI/CD workflows
docs/                 Operational and architectural documentation
```

---

## Commit conventions

Ajosave uses [Conventional Commits](https://www.conventionalcommits.org/). Every
commit message must match:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: Closes #N, BREAKING CHANGE: ...]
```

### Types

| Type | Use for |
|---|---|
| `feat` | New feature or behaviour |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Build process, tooling, dependencies |
| `ci` | CI workflow changes |
| `perf` | Performance improvement |

### Scopes (common examples)

`circle`, `payout`, `auth`, `contract`, `db`, `api`, `ui`, `e2e`, `docs`, `ci`

### Examples

```
feat(circle): add member-kick functionality

Allows the circle creator to remove a member before the first payout.
Emits a websocket event and records the action in the audit log.

Closes #42
```

```
fix(contract): prevent payout before all contributions received

Adds a guard in the payout function that panics if any member has
not contributed for the current cycle.

Closes #17
```

```
docs(contributing): expand contributor workflow guide

Closes #80
```

### Tips

- Keep the subject line under 72 characters.
- Use the imperative mood ("add", "fix", "update" — not "added", "fixed").
- Reference the issue number in the footer (`Closes #N`).

---

## Testing requirements

All changes must include appropriate tests. The required test type depends on
what you changed:

| Change type | Required test |
|---|---|
| New API route | Integration test in `src/__tests__/integration/` |
| New service / utility | Unit test in `src/__tests__/` or `src/lib/` |
| UI component | Visual snapshot update if it affects rendered output |
| Smart contract function | Rust unit test in `contracts/ajo/src/lib.rs` + fuzz coverage |
| Bug fix | Regression test that fails before the fix |
| CI workflow | Verify workflow runs without errors in a draft PR |

### Running tests

```bash
# Unit tests (Jest)
npm test

# Unit tests with coverage
npm test -- --coverage

# Integration tests only
npx jest --testPathPattern="integration" --runInBand --forceExit

# Realtime integration tests
npx jest --testPathPattern="realtime-integration" --runInBand --forceExit

# Contract tests (Rust)
npm run contract:test
# or: cd contracts && cargo test

# End-to-end tests (Playwright) — requires a running server
npm run build && npx next start &
npx playwright test

# Visual regression tests
npm run test:visual

# Update visual baselines after intentional UI change
npm run test:visual:update
```

### Coverage expectations

- New code paths must be covered by tests.
- Aim for ≥ 80 % branch coverage on new service/utility files.
- CI uploads coverage reports to Codecov — the badge on the README reflects
  the current state.

---

## Smart contract changes

The Ajo contract lives in `contracts/ajo/`. It handles the full savings circle
lifecycle on-chain (join, contribute, payout, rotation).

### Before changing contract code

1. Read `contracts/ajo/README.md` thoroughly.
2. Understand the state machine: `Pending → Active → Completed`.
3. Check `contracts/ajo/UPGRADE.md` for the upgrade and migration policy.

### Workflow

```bash
# Build the WASM binary
npm run contract:build

# Run all Rust tests (unit + property fuzz)
npm run contract:test

# Run libFuzzer targets locally (nightly Rust required)
rustup install nightly
cargo install cargo-fuzz --locked
cd contracts/ajo
cargo +nightly fuzz run fuzz_contribute -- -max_total_time=30

# Deploy to testnet (requires STELLAR_NETWORK=testnet in env)
STELLAR_NETWORK=testnet npm run contract:deploy
```

### Requirements for contract PRs

- All existing tests must pass.
- New contract functions must have a unit test AND a property fuzz case.
- Describe the state change and any migration needed in the PR description.
- Security-sensitive contract changes require **two** approving reviews.
- Never introduce integer arithmetic without `checked_add` / `checked_mul` guards.

---

## Opening a pull request

### 1. Prepare your branch

```bash
# Rebase onto the latest upstream/main (do not merge)
git fetch upstream
git rebase upstream/main

# Run all checks locally before pushing
npm run lint
npm run type-check
npm test
```

### 2. Push your branch

```bash
git push origin <your-branch-name>
```

### 3. Create the PR on GitHub

- **Base repository:** `joekeyz8/ajosave`
- **Base branch:** `main`
- **Compare branch:** `<YOUR_USERNAME>:<your-branch-name>`
- **Title:** Follow conventional commit format: `feat(scope): summary (#N)`
- **Fill in the PR template** completely — incomplete templates slow down reviews.

### PR checklist (from the template)

- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Types pass (`npm run type-check`)
- [ ] Contract tests pass (`npm run contract:test`) — if applicable
- [ ] No secrets committed
- [ ] Issue number linked in the footer (`Closes #N`)

### Draft PRs

Use a draft PR if you want early feedback before the work is complete. Mark it
ready for review when all checklist items are ticked and CI is green.

---

## Code review process

- All PRs require **at least one** approving review from a maintainer.
- Security-sensitive contract changes require **two** approvals.
- Reviewers aim to respond within 48 hours on weekdays.
- Address all reviewer comments before requesting a re-review.
- Maintainers may squash-merge to keep the history clean.

### What reviewers look at

1. Does the change solve the stated problem?
2. Are there adequate tests?
3. Does the code match project conventions?
4. Are there security implications (auth bypass, SQL injection, PII exposure)?
5. Is the PR description clear enough for someone reading it months later?

---

## CI checks explained

Every PR must pass all of the following before merge:

| Check | Workflow | What it does |
|---|---|---|
| Lint & Type Check | `ci.yml` | ESLint + TypeScript + Prettier format check |
| Unit Tests | `ci.yml` | Jest with coverage upload to Codecov |
| Next.js Build | `ci.yml` | Full production build |
| Security Audit | `security.yml` | CodeQL, npm audit, cargo-audit |
| Contract Fuzz (nightly) | `contract-fuzz.yml` | Property fuzz + libFuzzer targets |
| Visual Regression | `visual-regression.yml` | Playwright screenshot comparison (3 viewports) |
| Realtime Integration | `realtime-integration.yml` | WebSocket end-to-end tests |
| Branch Protection | `branch-protection.yml` | Enforces PR-only merges to `main` |

If a check fails:
1. Click the failing check in the PR to see the logs.
2. Fix the issue locally, push again — CI re-runs automatically.
3. For visual regression failures, download the diff artefact from the run
   and check whether the change was intentional. If so, run
   `npm run test:visual:update`, commit the updated snapshots, and push.

---

## Reporting issues

| Issue type | Where |
|---|---|
| Bug | [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) |
| Feature request | [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md) |
| Security vulnerability | **security@stellar.app** only — do not open a public issue |

Please search existing issues before filing a new one.

---

## Security disclosures

Security issues must be reported **privately** to **security@stellar.app**.
Do not open a public GitHub issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for the full disclosure policy and response SLA.
