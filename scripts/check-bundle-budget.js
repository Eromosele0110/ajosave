#!/usr/bin/env node
/* global require, module, process, console */
/* eslint-disable @typescript-eslint/no-require-imports, no-console */
/**
 * Asset bundle budget check.
 *
 * Reads the Next.js build manifests in `.next/`, computes the gzipped
 * first-load JS of every route plus the total client JS, and fails (exit 1)
 * when any value exceeds the limits in `bundle-budget.json`.
 *
 * Usage: npm run build && npm run bundle:check
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const KB = 1024;

function loadBudget(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const perRoute = Number(raw.perRoute);
  const total = Number(raw.total);
  if (!Number.isFinite(perRoute) || perRoute <= 0)
    throw new Error("bundle-budget.json: perRoute must be a positive number (KB)");
  if (!Number.isFinite(total) || total <= 0)
    throw new Error("bundle-budget.json: total must be a positive number (KB)");
  const routes = raw.routes && typeof raw.routes === "object" ? raw.routes : {};
  for (const [route, kb] of Object.entries(routes)) {
    if (!Number.isFinite(Number(kb)) || Number(kb) <= 0)
      throw new Error(`bundle-budget.json: routes["${route}"] must be a positive number (KB)`);
  }
  return { perRoute, total, routes };
}

/** Merge pages-router and app-router manifests into { route: [files] }, JS only. */
function collectRoutes(buildManifest, appBuildManifest) {
  const routes = {};
  const shared = [
    ...((buildManifest && buildManifest.rootMainFiles) || []),
    ...((buildManifest && buildManifest.polyfillFiles) || []),
  ];
  const add = (route, files) => {
    const js = [...shared, ...(files || [])].filter((f) => f.endsWith(".js"));
    routes[route] = Array.from(new Set(js));
  };
  for (const [route, files] of Object.entries((buildManifest && buildManifest.pages) || {})) {
    if (route === "/_app" || route === "/_error" || route === "/_document") continue;
    add(route, [...((buildManifest.pages && buildManifest.pages["/_app"]) || []), ...files]);
  }
  for (const [route, files] of Object.entries((appBuildManifest && appBuildManifest.pages) || {})) {
    add(route, files);
  }
  return routes;
}

/**
 * Pure evaluation: given route -> files, file -> gzip bytes and a budget,
 * return the report and the list of violations.
 */
function evaluate(routes, sizes, budget) {
  const report = [];
  const violations = [];
  const allFiles = new Set();
  for (const [route, files] of Object.entries(routes)) {
    let bytes = 0;
    for (const f of files) {
      allFiles.add(f);
      bytes += sizes[f] || 0;
    }
    const limitKb = Number(budget.routes[route] ?? budget.perRoute);
    const kb = bytes / KB;
    report.push({ route, kb, limitKb });
    if (kb > limitKb) violations.push(`${route}: ${kb.toFixed(1)} KB > ${limitKb} KB`);
  }
  let totalBytes = 0;
  allFiles.forEach((f) => (totalBytes += sizes[f] || 0));
  const totalKb = totalBytes / KB;
  if (totalKb > budget.total)
    violations.push(`total client JS: ${totalKb.toFixed(1)} KB > ${budget.total} KB`);
  return { report, totalKb, violations };
}

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function main(root = process.cwd()) {
  const nextDir = path.join(root, ".next");
  const buildManifest = readJson(path.join(nextDir, "build-manifest.json"));
  const appBuildManifest = readJson(path.join(nextDir, "app-build-manifest.json"));
  if (!buildManifest && !appBuildManifest) {
    console.error("bundle-budget: no Next.js build manifest found. Run `npm run build` first.");
    return 1;
  }
  const budget = loadBudget(path.join(root, "bundle-budget.json"));
  const routes = collectRoutes(buildManifest, appBuildManifest);
  const sizes = {};
  for (const files of Object.values(routes)) {
    for (const f of files) {
      if (sizes[f] !== undefined) continue;
      const abs = path.join(nextDir, f);
      sizes[f] = fs.existsSync(abs) ? gzipSize(abs) : 0;
    }
  }
  const { report, totalKb, violations } = evaluate(routes, sizes, budget);
  report
    .sort((a, b) => b.kb - a.kb)
    .forEach((r) => {
      const flag = r.kb > r.limitKb ? "✗" : "✓";
      console.log(
        `${flag} ${r.route.padEnd(50)} ${r.kb.toFixed(1).padStart(8)} KB / ${r.limitKb} KB`
      );
    });
  console.log(`Total client JS: ${totalKb.toFixed(1)} KB / ${budget.total} KB`);
  if (violations.length) {
    console.error(`\nBundle budget exceeded:\n  ${violations.join("\n  ")}`);
    return 1;
  }
  console.log("Bundle budgets OK");
  return 0;
}

module.exports = { loadBudget, collectRoutes, evaluate };

if (require.main === module) {
  process.exit(main());
}
