import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  type BindRequestInput,
  bindRequest,
  bindRequestFiles,
  type DeploymentSelection,
  validateDeployment,
  writeGitHubOutput,
} from "../src/instance.js";
import { instanceExitCode, runInstanceCommand } from "../src/instance-cli.js";

const margotRootPlaceholder = `\${MARGOT_ROOT}`;
const stalePlaceholder = `\${OLD_ROOT}`;
const head = "a".repeat(40);
const base = "b".repeat(40);
const deployment = {
  version: "0.6.1",
  packageReference:
    "https://github.com/example/margot-pr-reviewer/releases/download/v0.6.1/margot-pr-reviewer-0.6.1.tgz",
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
    executable: `${margotRootPlaceholder}/node_modules/.bin/claude`,
    ticketing: {
      server: "tickets",
      command: `${margotRootPlaceholder}/node_modules/.bin/tickets`,
      args: [],
      env: ["TICKET_TOKEN"],
      tools: ["mcp__tickets__read"],
    },
    version: "1.2.3",
    pluginDirectory: `${margotRootPlaceholder}/publish-skills`,
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
  merged: false,
  draft: false,
  mergeable: true,
  changed_files: 1,
  base: { sha: base },
  head: { sha: head, repo: { full_name: "example/project" } },
};
const bindInput = (overrides: Partial<BindRequestInput> = {}): BindRequestInput => ({
  repository: "example/project",
  pr: 7,
  expectedHead: head,
  phase: "review",
  authority: true,
  margotRoot: "/runtime/margot",
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
async function captureError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return undefined;
}
async function bindCommandFixture(authority: "true" | "false" = "false") {
  const directory = await mkdtemp(join(tmpdir(), "margot-command-bind-"));
  directories.push(directory);
  const configFile = join(directory, "trusted.json");
  await writeFile(configFile, JSON.stringify(config));
  return {
    directory,
    args: [
      "bind-request",
      "--repository",
      "example/project",
      "--pr",
      "7",
      "--head",
      head,
      "--phase",
      "review",
      "--authority",
      authority,
      "--margot-root",
      directory,
      "--config",
      configFile,
      "--required-checks",
      '["ci / required"]',
      "--protected-paths",
      '["protected/**"]',
      "--allowed-skipped-checks",
      '["ci / skipped"]',
      "--run-url",
      "https://github.com/example/control/actions/runs/3",
    ],
    client: { rest: { pulls: { get: async () => ({ data: pull }) } } },
  };
}
function closeCommandArgs(overrides: Record<string, string> = {}) {
  const values = {
    repository: "example/project",
    pr: "7",
    head,
    "app-id": "42",
    "own-runs": "https://github.com/example/control/actions/runs/",
    "own-run-id": "1",
    "route-result": "success",
    "review-result": "success",
    published: "false",
    "stop-reason": "floor",
    ...overrides,
  };
  return [
    "close-stranded-check",
    ...Object.entries(values).flatMap(([name, value]) => [`--${name}`, value]),
  ];
}
function closeCommandClient(options: { failPulls?: boolean; calls?: string[] } = {}) {
  const writes: Record<string, unknown>[] = [];
  const client = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: async () => {
          options.calls?.push("pulls");
          if (options.failPulls) throw new Error("Recorded pull read failure");
          return { data: [{ number: 7, state: "open", head: { sha: head } }] };
        },
      },
      checks: {
        listForRef: async () => ({
          data: {
            check_runs: [
              {
                id: 88,
                status: "in_progress",
                details_url: "https://github.com/example/control/actions/runs/1",
              },
            ],
          },
        }),
        update: async (input: Record<string, unknown>) => {
          writes.push(input);
          return { data: input };
        },
      },
    },
  };
  return { client: client as never, writes };
}
it("accepts the exact configured release and records authority", () => {
  let selected: DeploymentSelection | undefined;
  expect(() => {
    selected = validateDeployment(route({}));
  }).not.toThrow();
  expect(selected).toEqual({ authority: true, repositoryName: "project" });
});
it.each([
  [
    "rejects a release asset from a different repository",
    { releaseRepository: "other/margot-pr-reviewer" },
  ],
  [
    "rejects disagreement among deployment and asset versions",
    {
      deployment: {
        ...deployment,
        packageReference: deployment.packageReference.replaceAll("0.6.1", "0.6.2"),
      },
    },
  ],
  ["requires npm integrity", { deployment: { ...deployment, packageIntegrity: "missing" } }],
  ["requires the bootstrap SHA-256", { deployment: { ...deployment, packageSha256: "missing" } }],
  ["rejects an unenrolled target", { repository: "example/outside" }],
  ["rejects authority outside enrolment", { authorityRepositories: ["example/outside"] }],
] as const)("%s", (_name, invalid) => {
  expect(() => validateDeployment(route(invalid))).toThrow();
});
it.each([
  ["rejects a non-HTTPS release asset", "http://github.com"],
  ["rejects a release asset from another host", "https://example.com"],
  ["rejects a release asset with an explicit port", "https://github.com:444"],
  ["rejects a release asset with credentials", "https://user@github.com"],
  ["rejects a release asset with a query", `${deployment.packageReference}?x=1`],
  ["rejects a release asset with a fragment", `${deployment.packageReference}#x`],
] as const)("%s", (_name, replacement) => {
  const packageReference = replacement.includes("margot-pr-reviewer-0.6.1.tgz")
    ? replacement
    : deployment.packageReference.replace("https://github.com", replacement);
  expect(() =>
    validateDeployment(
      route({
        deployment: { ...deployment, packageReference },
      }),
    ),
  ).toThrow();
});
it.each([
  ["rejects duplicate enrolled repositories", "enrolledRepositories"],
  ["rejects duplicate authority repositories", "authorityRepositories"],
] as const)("%s", (_name, field) => {
  const duplicate = ["example/project", "example/project"];
  expect(() => validateDeployment(route({ [field]: duplicate }))).toThrow(/duplicates/);
});
it("returns false authority for an enrolled shadow", () => {
  const input: string[] = [];
  expect(validateDeployment(route({ authorityRepositories: input })).authority).toBe(false);
});
it("appends only the two safe GitHub outputs when the path is present", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-output-"));
  directories.push(directory);
  const path = join(directory, "output");
  await writeFile(path, "prior=value\n");
  await writeGitHubOutput({ authority: true, repositoryName: "project" }, path);
  expect(await readFile(path, "utf8")).toBe(
    "prior=value\nauthority=true\nrepositoryName=project\n",
  );
  await writeGitHubOutput({ authority: true, repositoryName: "project" }, undefined);
});
it("binds trusted policy and current PR facts for authority", async () => {
  const result = await bindRequest(bindInput({}), readPull());
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
  const result = await bindRequest(bindInput({ authority: false }), readPull());
  expect(result.config.review.publication).toBe("none");
  expect(result.config.github.shadowBeforeHead).toBe(true);
});
it("requires publisher configuration for authority", async () => {
  const { publisher: _publisher, ...withoutPublisher } = config;
  const error = await captureError(() =>
    bindRequest(bindInput({ config: withoutPublisher }), readPull()),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/publisher/);
});
it("requires a unique run URL for authority", async () => {
  const withRunUrl = bindInput();
  const { runUrl: _runUrl, ...withoutRunUrl } = withRunUrl;
  const error = await captureError(() => bindRequest(withoutRunUrl, readPull()));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/run URL/);
});
it("resolves runtime placeholders in Claude and ticketing paths", async () => {
  const root = "/runtime/margot";
  const result = await bindRequest(bindInput(), readPull());
  expect(result.config.claude).toMatchObject({
    executable: `${root}/node_modules/.bin/claude`,
    pluginDirectory: `${root}/publish-skills`,
    ticketing: { command: `${root}/node_modules/.bin/tickets` },
  });
});
it("rejects unresolved placeholders in executable paths at bind time", async () => {
  const cases = [
    {
      field: "claude.executable",
      placeholder: stalePlaceholder,
      config: {
        ...config,
        claude: {
          ...config.claude,
          executable: `${stalePlaceholder}/node_modules/.bin/claude`,
        },
      },
    },
    {
      field: "claude.pluginDirectory",
      placeholder: stalePlaceholder,
      config: {
        ...config,
        claude: { ...config.claude, pluginDirectory: `${stalePlaceholder}/publish-skills` },
      },
    },
    {
      field: "claude.ticketing.command",
      placeholder: stalePlaceholder,
      config: {
        ...config,
        claude: {
          ...config.claude,
          ticketing: {
            ...config.claude.ticketing,
            command: `${stalePlaceholder}/node_modules/.bin/tickets`,
          },
        },
      },
    },
    {
      field: "claude.executable",
      placeholder: `\${CUSTOM_ROOT}`,
      config: {
        ...config,
        claude: { ...config.claude, executable: `\${CUSTOM_ROOT}/claude` },
      },
    },
  ];
  for (const candidate of cases) {
    const error = await captureError(() =>
      bindRequest(
        bindInput({
          config: candidate.config,
        }),
        readPull(),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `Unresolved placeholder ${candidate.placeholder} in ${candidate.field}; the install root is \${MARGOT_ROOT}`,
    );
  }
});
it.each([
  ["classifies a superseded head", "superseded", { head: { ...pull.head, sha: "f".repeat(40) } }],
  ["classifies a merged PR", "merged", { state: "closed", merged: true }],
  ["classifies a closed unmerged PR", "closed", { state: "closed" }],
  ["classifies a draft PR", "draft", { draft: true }],
  [
    "classifies a fork-head PR",
    "fork",
    { head: { ...pull.head, repo: { full_name: "fork/project" } } },
  ],
  ["classifies a merge conflict", "conflict", { mergeable: false }],
  ["classifies an empty PR", "empty", { changed_files: 0 }],
] as const)("%s and writes stop_reason", async (_name, id, changed) => {
  const fixture = await bindCommandFixture("true");
  const candidate = { ...pull, ...changed };
  fixture.client.rest.pulls.get = async () => ({ data: candidate as typeof pull });
  const configFile = fixture.args.indexOf("--config") + 1;
  await writeFile(fixture.args[configFile] ?? "", "{");
  const output = join(fixture.directory, "github-output");
  const error = await captureError(() =>
    runInstanceCommand(
      fixture.args,
      { GH_TOKEN: "read-token", GITHUB_OUTPUT: output },
      fixture.client as never,
    ),
  );
  expect(error).toBeInstanceOf(Error);
  expect(instanceExitCode(error)).toBe(75);
  const fields = await readFile(output, "utf8");
  expect(fields).toContain(`stop_reason=${id}\n`);
  if (id === "superseded") expect(fields).toContain(`live_sha=${"f".repeat(40)}\n`);
});
it("classifies the PR before rejecting invalid trusted configuration", async () => {
  let reads = 0;
  const invalid = { ...config, claude: { ...config.claude, executable: "" } };
  const error = await captureError(() =>
    bindRequest(bindInput({ config: invalid }), async () => {
      reads++;
      return pull;
    }),
  );
  expect(error).toBeInstanceOf(Error);
  expect(reads).toBe(1);
});
it("requires an absolute runtime root", async () => {
  expect(
    await captureError(() => bindRequest(bindInput({ margotRoot: "relative" }), readPull())),
  ).toBeInstanceOf(Error);
});
it("writes the two bound files privately under the Margot root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-bind-"));
  directories.push(directory);
  const configFile = join(directory, "trusted.json");
  await writeFile(configFile, JSON.stringify(config));
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          data: pull,
        }),
      },
    },
  };
  const result = await bindRequestFiles(
    { ...bindInput({ margotRoot: directory }), configFile },
    "read-token",
    github as never,
  );
  expect(result.request.base).toBe(base);
  expect(JSON.parse(await readFile(join(directory, "request.json"), "utf8"))).toEqual(
    result.request,
  );
  expect(JSON.parse(await readFile(join(directory, "config.json"), "utf8"))).toEqual(result.config);
  expect((await stat(join(directory, "request.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, "config.json"))).mode & 0o777).toBe(0o600);
});
it("requires GH_TOKEN before reading configuration or GitHub", async () => {
  const error = await captureError(() =>
    bindRequestFiles({ ...bindInput(), configFile: "/not-read" }, undefined),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/GH_TOKEN/);
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
  expect(await runInstanceCommand(args, { GITHUB_OUTPUT: output })).toEqual({
    authority: true,
    repositoryName: "project",
  });
  expect(await readFile(output, "utf8")).toBe("authority=true\nrepositoryName=project\n");
});
it("rejects unknown deployment command arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-command-unknown-"));
  directories.push(directory);
  const deploymentFile = join(directory, "deployment.json");
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
  args.push("--unknown", "value");
  const error = await captureError(() => runInstanceCommand(args, {}));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Unknown argument/);
});
it("rejects duplicate flags after parseArgs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-command-duplicate-"));
  directories.push(directory);
  const deploymentFile = join(directory, "deployment.json");
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
  args.push("--repository", "example/project");
  const error = await captureError(() => runInstanceCommand(args, {}));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Duplicate argument: --repository");
});
it("maps the close-stranded-check command into the guarded closer", async () => {
  const { client, writes } = closeCommandClient();
  const result = await runInstanceCommand(
    closeCommandArgs({ published: "false" }),
    { GH_TOKEN: "write-token" },
    client,
  );
  expect(result).toMatchObject({ action: "closed" });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ conclusion: "action_required" });
});
it("maps a closer GitHub failure to exit 2", async () => {
  const { client } = closeCommandClient({ failPulls: true });
  const error = await captureError(() =>
    runInstanceCommand(closeCommandArgs(), { GH_TOKEN: "write-token" }, client),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("could not read the pull requests");
  expect(instanceExitCode(error)).toBe(2);
});
it("rejects a run URL prefix without its trailing slash", async () => {
  const ownRuns = "https://github.com/example/control/actions/runs";
  const error = await captureError(() =>
    runInstanceCommand(closeCommandArgs({ "own-runs": ownRuns }), {}),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("--own-runs must be a run URL prefix ending in /");
  expect(instanceExitCode(error)).toBe(1);
});
it("rejects a malformed closer repository before GitHub", async () => {
  const calls: string[] = [];
  const { client } = closeCommandClient({ calls });
  const repository = "example";
  const error = await captureError(() =>
    runInstanceCommand(closeCommandArgs({ repository }), { GH_TOKEN: "write-token" }, client),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("Repository must be owner/name");
  expect(instanceExitCode(error)).toBe(1);
  expect(calls).toHaveLength(0);
});
it("maps every bind-request CLI flag into the bound files", async () => {
  const fixture = await bindCommandFixture("false");
  await runInstanceCommand(fixture.args, { GH_TOKEN: "read-token" }, fixture.client as never);
  const request = JSON.parse(await readFile(join(fixture.directory, "request.json"), "utf8"));
  const bound = JSON.parse(await readFile(join(fixture.directory, "config.json"), "utf8"));
  expect(request).toEqual({ repository: "example/project", pr: 7, base, head, phase: "review" });
  expect(bound.review).toMatchObject({
    publication: "none",
    requiredChecks: ["ci / required"],
    protectedPaths: ["protected/**"],
    allowedSkippedChecks: ["ci / skipped"],
  });
  expect(bound.github.shadowBeforeHead).toBe(true);
  expect(bound.publisher.runUrl).toBe("https://github.com/example/control/actions/runs/1");
});
it("binds the sample config as a shadow when a run URL is supplied", async () => {
  const fixture = await bindCommandFixture("false");
  const configFile = fixture.args.indexOf("--config") + 1;
  fixture.args[configFile] = "samples/config.sample.json";
  const error = await captureError(async () => {
    const result = await runInstanceCommand(
      fixture.args,
      { GH_TOKEN: "read-token" },
      fixture.client as never,
    );
    if (!("config" in result)) throw new Error("Expected bound request");
    expect(result.config.review.publication).toBe("none");
    expect(result.config.publisher).toBeUndefined();
  });
  expect(error).toBeUndefined();
});
it("rejects an explicitly empty bind-request run URL", async () => {
  const fixture = await bindCommandFixture("true");
  const runUrl = fixture.args.indexOf("--run-url") + 1;
  fixture.args[runUrl] = "";
  const error = await captureError(() =>
    runInstanceCommand(fixture.args, { GH_TOKEN: "read-token" }, fixture.client as never),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/run-url/);
});
