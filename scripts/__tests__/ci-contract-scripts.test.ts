/**
 * Testnet deployment smoke test wiring (Issue #57)
 *
 * `.github/workflows/staging-deploy.yml` deploys the Ajo contract to testnet
 * and then runs `npm run contract:verify` (scripts/verify-contract.ts) as a
 * post-deploy smoke test that calls `get_state()` on the freshly deployed
 * contract and fails the job if the contract does not respond.
 *
 * That `contract:verify` script previously existed on disk but was never
 * registered in package.json's `scripts`, so the CI step would fail with
 * "npm error Missing script: contract:verify" on every testnet deploy. This
 * test locks in the fix and guards against the same class of drift for any
 * other `npm run` step the workflow relies on.
 */
import * as fs from "fs";
import * as path from "path";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")
) as { scripts: Record<string, string> };

const workflowPath = path.resolve(__dirname, "../../.github/workflows/staging-deploy.yml");
const workflow = fs.readFileSync(workflowPath, "utf-8");

describe("testnet deployment smoke test wiring", () => {
  it("defines every `npm run <script>` referenced by the staging/testnet deploy workflow", () => {
    const referenced = Array.from(workflow.matchAll(/npm run ([\w:-]+)/g)).map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const scriptName of referenced) {
      expect(pkg.scripts).toHaveProperty(scriptName);
    }
  });

  it("wires a post-deploy smoke-test/verification step for the testnet contract job", () => {
    expect(workflow).toMatch(/contract:verify/);
    expect(pkg.scripts["contract:verify"]).toBe("ts-node scripts/verify-contract.ts");
  });

  it("keeps the deploy and verify scripts pointed at real files", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../deploy-contract.ts"))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, "../verify-contract.ts"))).toBe(true);
  });
});
