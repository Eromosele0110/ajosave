/* eslint-disable @typescript-eslint/no-require-imports */
const { collectRoutes, evaluate } = require("../../../scripts/check-bundle-budget");

const budget = { perRoute: 100, total: 250, routes: { "/dashboard": 150 } };
const KB = 1024;

describe("bundle budget", () => {
  it("merges shared chunks into every route and ignores non-JS files", () => {
    const routes = collectRoutes(
      {
        rootMainFiles: ["main.js"],
        polyfillFiles: ["poly.js"],
        pages: { "/_app": ["app.js"], "/about": ["about.js", "about.css"] },
      },
      { pages: { "/dashboard/page": ["dash.js"] } }
    );
    expect(routes["/about"]).toEqual(["main.js", "poly.js", "app.js", "about.js"]);
    expect(routes["/dashboard/page"]).toEqual(["main.js", "poly.js", "dash.js"]);
    expect(routes["/_app"]).toBeUndefined();
  });

  it("passes when a route is exactly at budget", () => {
    expect(evaluate({ "/": ["a.js"] }, { "a.js": 100 * KB }, budget).violations).toEqual([]);
  });

  it("flags a route one byte over the default budget", () => {
    const res = evaluate({ "/": ["a.js"] }, { "a.js": 100 * KB + 1 }, budget);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]).toMatch(/^\/:/);
  });

  it("applies per-route overrides", () => {
    expect(evaluate({ "/dashboard": ["d.js"] }, { "d.js": 140 * KB }, budget).violations).toEqual(
      []
    );
  });

  it("counts shared files once toward the total budget", () => {
    const routes = {
      "/a": ["shared.js", "a.js"],
      "/b": ["shared.js", "b.js"],
      "/c": ["shared.js", "c.js"],
    };
    const sizes = { "shared.js": 50 * KB, "a.js": 50 * KB, "b.js": 50 * KB, "c.js": 50 * KB };
    expect(evaluate(routes, sizes, budget).totalKb).toBe(200);
    const res = evaluate({ ...routes, "/d": ["d.js"] }, { ...sizes, "d.js": 60 * KB }, budget);
    expect(res.violations.some((v: string) => v.startsWith("total"))).toBe(true);
  });

  it("treats missing files as zero bytes", () => {
    expect(evaluate({ "/": ["missing.js"] }, {}, budget).violations).toEqual([]);
  });
});
