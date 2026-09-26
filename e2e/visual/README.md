# Visual Regression Tests

Playwright screenshot comparison tests for key Ajosave pages across three
responsive viewports: **desktop** (1280 × 800), **tablet** (iPad Mini), and
**mobile** (Pixel 5).

## How it works

- On first run (or after `--update-snapshots`), Playwright captures **baseline** PNG screenshots and stores them in `__snapshots__/`.
- On subsequent runs it compares the current render against the baseline. Any diff exceeding **0.1%** of total pixels fails the test.
- Baselines are committed to the repo. Diffs and actuals are gitignored.

## Viewports

| Project | Device | Width |
|---|---|---|
| `visual-desktop` | Desktop Chrome | 1280 px |
| `visual-tablet` | iPad Mini | 768 px |
| `visual-mobile` | Pixel 5 | 393 px |

## Running locally

```bash
# All visual tests across all viewports
npm run test:visual

# Single viewport
npx playwright test --project=visual-desktop
npx playwright test --project=visual-tablet
npx playwright test --project=visual-mobile

# Update baselines after an intentional UI change
npm run test:visual:update

# Update baselines for one viewport only
npx playwright test --project=visual-mobile --update-snapshots
```

## Capturing initial baselines

If you're setting up for the first time (no snapshots committed yet):

```bash
npm run build
npx next start &
npm run test:visual:update
```

Then commit the generated `e2e/visual/__snapshots__/` files.

## CI behaviour

- The `visual-regression.yml` workflow runs on every push/PR to `main` and `develop`.
- Each viewport runs in a separate matrix job so failures are isolated.
- On failure, diff images are uploaded as `visual-regression-report-<viewport>` (retained 30 days).
- A comment is automatically posted on the PR with a link to the artefact and the update command.

## Specs

| File | Coverage |
|---|---|
| `home.visual.spec.ts` | Landing page |
| `auth.visual.spec.ts` | Login / OTP pages |
| `circles.visual.spec.ts` | Browse, detail, create |
| `dashboard.visual.spec.ts` | Dashboard |
| `profile.visual.spec.ts` | Profile & settings |
| `responsive-layout.visual.spec.ts` | Cross-breakpoint layout, navbar collapse |

## Adding new pages

1. Create `e2e/visual/<page-name>.visual.spec.ts`.
2. Use `toHaveScreenshot()` — Playwright handles the comparison automatically.
3. Run `npm run test:visual:update` to capture the baseline for all viewports, then commit the snapshots.
