import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Existing functional E2E tests
    {
      name: "chromium",
      testMatch: /e2e\/(?!visual\/).*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Visual regression tests — desktop viewport
    {
      name: "visual-desktop",
      testMatch: /e2e\/visual\/.*\.visual\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        // Disable animations so screenshots are deterministic
        launchOptions: { args: ["--force-prefers-reduced-motion"] },
      },
      // Fail CI on any pixel diff exceeding 0.1% of total pixels
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.001,
          // Store baselines alongside the spec files
          snapshotPathTemplate:
            "{testDir}/visual/__snapshots__/{projectName}/{testFilePath}/{arg}{ext}",
        },
      },
    },
    // Visual regression tests — mobile viewport
    {
      name: "visual-mobile",
      testMatch: /e2e\/visual\/.*\.visual\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        // Disable animations so screenshots are deterministic
        launchOptions: { args: ["--force-prefers-reduced-motion"] },
      },
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.001,
          snapshotPathTemplate:
            "{testDir}/visual/__snapshots__/{projectName}/{testFilePath}/{arg}{ext}",
        },
      },
    },
    // Visual regression tests — tablet viewport (iPad Mini)
    {
      name: "visual-tablet",
      testMatch: /e2e\/visual\/.*\.visual\.spec\.ts/,
      use: {
        ...devices["iPad Mini"],
        // Disable animations so screenshots are deterministic
        launchOptions: { args: ["--force-prefers-reduced-motion"] },
      },
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.001,
          snapshotPathTemplate:
            "{testDir}/visual/__snapshots__/{projectName}/{testFilePath}/{arg}{ext}",
        },
      },
    },
  ],
});
