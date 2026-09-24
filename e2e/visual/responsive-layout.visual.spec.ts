/**
 * responsive-layout.visual.spec.ts
 *
 * Visual baselines for responsive layout breakpoints across all key pages.
 * Covers the navigation collapse, hero section reflow, circle-card grid, and
 * dashboard layout at 320 px, 768 px, and 1280 px widths.
 *
 * The actual viewport is set by the Playwright project (`visual-desktop`,
 * `visual-tablet`, `visual-mobile`) — these tests are shared across all three.
 */

import { test, expect } from "@playwright/test";
import { mockAuthSession } from "../helpers/auth";

// ── Shared mock data ────────────────────────────────────────────────────────

const MOCK_CIRCLES = [
  {
    id: "circle-1",
    name: "Lagos Savers",
    status: "open",
    contributionFiat: 10000,
    contributionCurrency: "NGN",
    circleType: "public",
    maxMembers: 5,
    memberCount: 2,
    currentCycle: 0,
    cycleFrequency: "monthly",
    creatorId: "user-99",
  },
  {
    id: "circle-2",
    name: "Abuja Weekly Circle",
    status: "active",
    contributionFiat: 25000,
    contributionCurrency: "NGN",
    circleType: "public",
    maxMembers: 10,
    memberCount: 7,
    currentCycle: 3,
    cycleFrequency: "weekly",
    creatorId: "user-88",
  },
  {
    id: "circle-3",
    name: "Diaspora Savings",
    status: "open",
    contributionFiat: 50,
    contributionCurrency: "USDC",
    circleType: "private",
    maxMembers: 8,
    memberCount: 1,
    currentCycle: 0,
    cycleFrequency: "biweekly",
    creatorId: "user-77",
  },
];

const MOCK_MY_CIRCLES = [MOCK_CIRCLES[0]];

// ── Homepage ────────────────────────────────────────────────────────────────

test.describe("Visual: Homepage — responsive layout", () => {
  test("homepage layout matches snapshot", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Mask any dynamic timestamps or counters so the snapshot stays stable.
    await expect(page).toHaveScreenshot("homepage-layout.png", {
      fullPage: true,
      mask: [page.locator("time"), page.locator("[data-testid='live-count']")],
    });
  });
});

// ── Auth / Login ─────────────────────────────────────────────────────────────

test.describe("Visual: Auth page — responsive layout", () => {
  test("login page layout matches snapshot", async ({ page }) => {
    await page.goto("/auth/login");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("auth-login-layout.png", {
      fullPage: true,
    });
  });
});

// ── Circles browse ───────────────────────────────────────────────────────────

test.describe("Visual: Circles browse — responsive layout", () => {
  test.beforeEach(async ({ page, context }) => {
    await mockAuthSession(context, page);
    await page.route("/api/circles*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: MOCK_CIRCLES,
          total: MOCK_CIRCLES.length,
        }),
      })
    );
  });

  test("circles list layout matches snapshot", async ({ page }) => {
    await page.goto("/circles");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("circles-list-layout.png", {
      fullPage: true,
    });
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

test.describe("Visual: Dashboard — responsive layout", () => {
  test.beforeEach(async ({ page, context }) => {
    await mockAuthSession(context, page);
    await page.route("/api/circles/my*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: MOCK_MY_CIRCLES }),
      })
    );
  });

  test("dashboard layout matches snapshot", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("dashboard-layout.png", {
      fullPage: true,
    });
  });
});

// ── Navbar collapse (mobile) ─────────────────────────────────────────────────

test.describe("Visual: Navbar — responsive collapse", () => {
  test("navbar collapsed state matches snapshot", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Capture just the header region to isolate the nav layout.
    const header = page.locator("header").first();
    await expect(header).toHaveScreenshot("navbar-header.png");
  });
});
