import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarball = resolve(process.argv[2] ?? "margot-pr-reviewer-0.6.1.tgz");
const consumer = mkdtempSync(join(tmpdir(), "margot-slice4-consumer-"));
const run = (file, args, options = {}) =>
  spawnSync(file, args, { cwd: consumer, encoding: "utf8", ...options });
writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
const installed = run("npm", ["install", "--ignore-scripts", tarball]);
assert.equal(installed.status, 0, installed.stderr);
copyFileSync(new URL("./consumer-smoke.mjs", import.meta.url), join(consumer, "smoke.mjs"));
const smoke = () => run(process.execPath, ["smoke.mjs"]);
assert.equal(smoke().status, 0, "Installed API must review a recorded PR");
const cli = join(consumer, "node_modules/.bin/margot-review");
const instanceCli = join(consumer, "node_modules/.bin/margot-instance");
const installedPackage = join(consumer, "node_modules/margot-pr-reviewer");
assert.equal(
  existsSync(join(installedPackage, "action.yml")),
  false,
  "Package must omit action.yml",
);
assert.equal(run(instanceCli, []).status, 1, "Installed instance CLI must require a command");
const closerNoop = run(instanceCli, [
  "close-stranded-check",
  "--repository",
  "example/project",
  "--pr",
  "7",
  "--head",
  "a".repeat(40),
  "--app-id",
  "42",
  "--own-runs",
  "https://github.com/example/control/actions/runs/",
  "--own-run-id",
  "1",
  "--route-result",
  "success",
  "--review-result",
  "success",
  "--published",
  "true",
  "--stop-reason",
  "",
]);
assert.equal(closerNoop.status, 0, closerNoop.stderr);
assert.equal(closerNoop.stdout, "nothing to close\n");
const deployment = join(consumer, "deployment.json");
const output = join(consumer, "output");
writeFileSync(
  deployment,
  JSON.stringify({
    version: "0.6.1",
    packageReference:
      "https://github.com/example/margot-pr-reviewer/releases/download/v0.6.1/margot-pr-reviewer-0.6.1.tgz",
    packageIntegrity: `sha512-${"A".repeat(86)}==`,
    packageSha256: "0".repeat(64),
  }),
);
assert.equal(
  run(
    instanceCli,
    [
      "validate-deployment",
      "--deployment",
      deployment,
      "--release-repository",
      "example/margot-pr-reviewer",
      "--repository",
      "example/project",
      "--enrolled-repositories",
      '["example/project"]',
      "--authority-repositories",
      '["example/project"]',
    ],
    { env: { ...process.env, GITHUB_OUTPUT: output } },
  ).status,
  0,
  "Installed instance CLI must validate and emit the route",
);
assert.equal(readFileSync(output, "utf8"), "authority=true\nrepositoryName=project\n");
const checkCli = () =>
  assert.equal(run(cli, []).status, 1, "Installed CLI must execute argument validation");
checkCli();
const realCli = realpathSync(cli);
const original = readFileSync(realCli);
let detected = false;
try {
  writeFileSync(realCli, "#!/usr/bin/env node\n");
  try {
    checkCli();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = true;
  }
} finally {
  writeFileSync(realCli, original);
}
assert.equal(detected, true, "Empty CLI mutation must fail the argument-validation smoke");
checkCli();
assert.equal(smoke().status, 0);
writeFileSync(
  new URL("../docs/package-smoke-receipt.md", import.meta.url),
  `# Installed package receipt\n\nGenerated ${new Date().toISOString()}, Node ${process.version}.\n\nInstalled the tarball in an empty directory outside the source tree. The package omitted action.yml. The existing consumer smoke imported the public package, completed a recorded approval, introduced a mandatory finding, and observed CHANGES_REQUESTED in the same result and recorded publication. It passed before and after the CLI break.\n\nCLI smoke: invoking each npm-created executable link without arguments exits 1 through argument validation. The instance CLI validates a deployment, enrolment, and authority selection through the installed binary and emits its two GitHub outputs; its closer also returns “nothing to close” without a token or network call when all jobs succeeded and the selected package published. Replacing the review CLI's installed target with an empty executable changed its exit to 0 and failed exactly that assertion. Restoring the file restored the passing check. This proves installed entrypoint execution, not live service availability or a hosted Action run.\n\nReproduce: npm pack; node scripts/package-smoke.mjs ./margot-pr-reviewer-0.6.1.tgz.\n`,
);
console.log(
  JSON.stringify({
    consumer,
    recordedApi: "passed",
    cli: "passed",
    instanceCli: "passed",
    cliBreak: "one assertion failed",
    restored: "passed",
  }),
);
