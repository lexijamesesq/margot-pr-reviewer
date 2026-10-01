import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  type BindRequestInput,
  bindRequest,
  bindRequestFiles,
  validateDeployment,
  writeGitHubOutput,
} from "../src/instance.js";
import { runInstanceCommand } from "../src/instance-cli.js";

const broken = process.env.MARGOT_INSTANCE_BREAK;
const engineRootPlaceholder = `\${ENGINE_ROOT}`;
const head = "a".repeat(40);
const base = "b".repeat(40);
const deployment = {
  version: "0.5.0",
  packageReference:
    "https://github.com/example/margot-pr-reviewer/releases/download/v0.5.0/margot-pr-reviewer-0.5.0.tgz",
  packageIntegrity: `sha512-${"A".repeat(86)}==`,
  packageSha256: "c".repeat(64),
};
const route = (overrides: Record<string, unknown> = {}) => ({
  deployment,
  releaseRepository: "example/margot-pr-reviewer",
  repository: "example/project",
  enrolledRepositories: ["example/project", "example/shadow"],
  authorityRepositories: ["example/project"],
  ...overrides,
});
const config = {
  review: {
    protectedPaths: [],
    trustedCheckActors: ["checks"],
    trustedTriageActors: ["triage"],
    trustedLedgerActors: ["reviewer[bot]"],
    requiredChecks: [],
    allowedSkippedChecks: [],
    cardBundle: { commit: "d".repeat(40) },
    classificationThreshold: 0.6,
    routeThreshold: 0.35,
    riskTailThreshold: 0.3,
    confidenceThreshold: 0.3,
    noCouncilConfidenceFloor: 0.3,
    timeoutMs: 1000,
    publication: "none",
    calibration: false,
  },
  github: { freshShadow: false },
  jev: { model: "jev-test" },
  claude: {
    executable: `${engineRootPlaceholder}/node_modules/.bin/claude`,
    ticketing: {
      server: "tickets",
      command: `${engineRootPlaceholder}/node_modules/.bin/tickets`,
      args: [],
      env: ["TICKET_TOKEN"],
      tools: ["mcp__tickets__read"],
    },
    version: "1.2.3",
    pluginDirectory: `${engineRootPlaceholder}/publish-skills`,
    reviewerModel: "reviewer",
  },
  publisher: {
    checks: {
      triage: "review / triage",
      review: "review / margot",
      authority: "review / authority",
    },
    actor: "reviewer[bot]",
    appId: 1,
    runUrl: "https://github.com/example/control/actions/runs/1",
  },
};
const pull = {
  state: "open",
  draft: false,
  base: { sha: base },
  head: { sha: head, repo: { full_name: "example/project" } },
};
const bindInput = (overrides: Partial<BindRequestInput> = {}): BindRequestInput => ({
  repository: "example/project",
  pr: 7,
  expectedHead: head,
  phase: "review",
  authority: true,
  engineRoot: "/runtime/margot",
  config,
  requiredChecks: ["ci / checks"],
  protectedPaths: [".github/**"],
  allowedSkippedChecks: ["ci / optional"],
  runUrl: "https://github.com/example/control/actions/runs/2",
  ...overrides,
});
const readPull =
  (value: unknown = pull) =>
  async () =>
    value;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

it("accepts the exact configured release and records authority", () => {
  const selected = validateDeployment(
    route(
      broken === "deployment-success"
        ? { deployment: { ...deployment, packageReference: "latest" } }
        : {},
    ),
  );
  expect(selected).toEqual({ authority: true, repositoryName: "project" });
});

it.each([
  [
    "release-repository",
    "rejects a release asset from a different repository",
    { releaseRepository: "other/margot-pr-reviewer" },
  ],
  [
    "release-version",
    "rejects disagreement among deployment and asset versions",
    {
      deployment: {
        ...deployment,
        packageReference: deployment.packageReference.replaceAll("0.5.0", "0.5.1"),
      },
    },
  ],
  [
    "release-integrity",
    "requires npm integrity",
    { deployment: { ...deployment, packageIntegrity: "missing" } },
  ],
  [
    "release-sha256",
    "requires the bootstrap SHA-256",
    { deployment: { ...deployment, packageSha256: "missing" } },
  ],
  ["enrolment", "rejects an unenrolled target", { repository: "example/outside" }],
  [
    "authority-enrolment",
    "rejects authority outside enrolment",
    { authorityRepositories: ["example/outside"] },
  ],
] as const)("%s: %s", (id, _name, invalid) => {
  expect(() => validateDeployment(route(broken === id ? {} : invalid))).toThrow();
});

it("returns false authority for an enrolled shadow", () => {
  const input = broken === "shadow-selection" ? ["example/project"] : [];
  expect(validateDeployment(route({ authorityRepositories: input })).authority).toBe(false);
});

it("appends only the two safe GitHub outputs when the path is present", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-output-"));
  directories.push(directory);
  const path = join(directory, "output");
  await writeFile(path, "prior=value\n");
  await writeGitHubOutput(
    { authority: broken !== "github-output", repositoryName: "project" },
    path,
  );
  expect(await readFile(path, "utf8")).toBe(
    "prior=value\nauthority=true\nrepositoryName=project\n",
  );
  await writeGitHubOutput({ authority: true, repositoryName: "project" }, undefined);
});

it("binds trusted policy and current PR facts for authority", async () => {
  const result = await bindRequest(
    bindInput(broken === "authority-binding" ? { requiredChecks: ["changed"] } : {}),
    readPull(),
  );
  expect(result.request).toEqual({
    repository: "example/project",
    pr: 7,
    base,
    head,
    phase: "review",
  });
  expect(result.config.review).toMatchObject({
    requiredChecks: ["ci / checks"],
    protectedPaths: [".github/**"],
    allowedSkippedChecks: ["ci / optional"],
    publication: "github",
  });
  expect(result.config.github.shadowBeforeHead).toBe(false);
  expect(result.config.publisher?.runUrl).toBe("https://github.com/example/control/actions/runs/2");
});

it("binds non-authority execution as a before-head shadow", async () => {
  const result = await bindRequest(
    bindInput({ authority: broken === "shadow-binding" }),
    readPull(),
  );
  expect(result.config.review.publication).toBe("none");
  expect(result.config.github.shadowBeforeHead).toBe(true);
});

it("resolves runtime placeholders in Claude and ticketing paths", async () => {
  const root = broken === "placeholder-resolution" ? "/other" : "/runtime/margot";
  const result = await bindRequest(bindInput(), readPull());
  expect(result.config.claude).toMatchObject({
    executable: `${root}/node_modules/.bin/claude`,
    pluginDirectory: `${root}/publish-skills`,
    ticketing: { command: `${root}/node_modules/.bin/tickets` },
  });
});

it.each([
  ["closed", "rejects a closed PR", { state: "closed" }],
  ["draft", "rejects a draft PR", { draft: true }],
  ["fork", "rejects a fork PR", { head: { ...pull.head, repo: { full_name: "fork/project" } } }],
  ["moved", "rejects a moved head", { head: { ...pull.head, sha: "f".repeat(40) } }],
] as const)("%s: %s", async (id, _name, changed) => {
  const candidate = broken === id ? pull : { ...pull, ...changed };
  await expect(bindRequest(bindInput(), readPull(candidate))).rejects.toThrow();
});

it("rejects an invalid trusted configuration before reading GitHub", async () => {
  let reads = 0;
  const invalid = { ...config, claude: { ...config.claude, executable: "" } };
  await expect(
    bindRequest(bindInput({ config: broken === "trusted-config" ? config : invalid }), async () => {
      reads++;
      return pull;
    }),
  ).rejects.toThrow();
  expect(reads).toBe(0);
});

it("requires an absolute runtime root", async () => {
  await expect(
    bindRequest(
      bindInput({ engineRoot: broken === "absolute-root" ? "/runtime" : "relative" }),
      readPull(),
    ),
  ).rejects.toThrow();
});

it("writes the two bound files privately under the engine root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-bind-"));
  directories.push(directory);
  const configFile = join(directory, "trusted.json");
  await writeFile(configFile, JSON.stringify(config));
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: broken === "bound-files" ? { ...pull, draft: true } : pull }),
      },
    },
  };
  const result = await bindRequestFiles(
    { ...bindInput({ engineRoot: directory }), configFile },
    "read-token",
    github as never,
  );
  expect(JSON.parse(await readFile(join(directory, "request.json"), "utf8"))).toEqual(
    result.request,
  );
  expect(JSON.parse(await readFile(join(directory, "config.json"), "utf8"))).toEqual(result.config);
  expect((await stat(join(directory, "request.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, "config.json"))).mode & 0o777).toBe(0o600);
});

it("requires GH_TOKEN before reading configuration or GitHub", async () => {
  await expect(
    bindRequestFiles(
      { ...bindInput(), configFile: broken === "github-token" ? "/missing" : "/not-read" },
      broken === "github-token" ? "token" : undefined,
    ),
  ).rejects.toThrow(/GH_TOKEN/);
});

it("parses the strict deployment command and emits its outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-command-"));
  directories.push(directory);
  const deploymentFile = join(directory, "deployment.json");
  const output = join(directory, "output");
  await writeFile(deploymentFile, JSON.stringify(deployment));
  const args = [
    "validate-deployment",
    "--deployment",
    deploymentFile,
    "--release-repository",
    "example/margot-pr-reviewer",
    "--repository",
    "example/project",
    "--enrolled-repositories",
    '["example/project"]',
    "--authority-repositories",
    '["example/project"]',
  ];
  if (broken === "command-arguments") args.push("--unknown", "value");
  expect(await runInstanceCommand(args, { GITHUB_OUTPUT: output })).toEqual({
    authority: true,
    repositoryName: "project",
  });
  expect(await readFile(output, "utf8")).toBe("authority=true\nrepositoryName=project\n");
});
