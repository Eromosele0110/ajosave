# Contributor Workflow Quick Reference

This page summarises the full workflow. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for the complete guide.

## First-time setup

```bash
# Fork on GitHub, then:
git clone https://github.com/<YOU>/ajosave.git && cd ajosave
git remote add upstream https://github.com/joekeyz8/ajosave.git
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

## Typical contribution loop

```bash
# 1. Sync your fork
git fetch upstream && git checkout main && git merge upstream/main

# 2. Branch
git checkout -b feat/issue-<N>-<slug>

# 3. Code + test
# ... make changes ...
npm run lint && npm run type-check && npm test

# 4. Commit (Conventional Commits)
git commit -m "feat(scope): summary

Closes #N"

# 5. Push to your fork
git push origin feat/issue-<N>-<slug>

# 6. Open PR → base: joekeyz8/ajosave main
```

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript |
| `npm test` | Jest unit tests |
| `npm test -- --coverage` | With coverage |
| `npx jest --testPathPattern="integration" --runInBand --forceExit` | Integration tests |
| `npm run contract:build` | Build Soroban WASM |
| `npm run contract:test` | Rust tests |
| `npm run test:visual` | Playwright visual regression |
| `npm run test:visual:update` | Update visual baselines |

## Branch naming

```
feat/issue-<N>-<slug>       New features
fix/issue-<N>-<slug>        Bug fixes
docs/issue-<N>-<slug>       Documentation
refactor/issue-<N>-<slug>   Refactoring
chore/<slug>                Tooling / CI
```

## PR requirements

- Title: `feat(scope): summary (#N)`
- Linked issue: `Closes #N` in commit footer
- All CI checks green
- At least one maintainer approval (two for contract security changes)
