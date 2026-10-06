import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bindRequest, bindRequestFiles } from "../../src/instance.js";
import { instanceExitCode, runInstanceCommand } from "../../src/instance-cli.js";
import { liveConfigSchema } from "../../src/schemas.js";
import {
  base,
  bindCommandFixture,
  bindInput,
  captureError,
  config,
  directories,
  head,
  pull,
  readPull,
  stalePlaceholder,
} from "../helpers/instance.js";

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
it("resolves runtime placeholders in Claude paths and leaves the in-container ticketing command alone", async () => {
  const root = "/runtime/margot";
  const result = await bindRequest(bindInput(), readPull());
  expect(result.config.claude).toMatchObject({
    executable: `${root}/node_modules/.bin/claude`,
    pluginDirectory: `${root}/publish-skills`,
    ticketing: { command: "tickets" },
    container: { work: `${root}/base` },
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
      field: "claude.container.work",
      placeholder: stalePlaceholder,
      config: {
        ...config,
        claude: {
          ...config.claude,
          container: { ...config.claude.container, work: `${stalePlaceholder}/base` },
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
it("refuses a ticketing command that names the Margot root, since it runs in the container", async () => {
  const commands = [
    `\${MARGOT_ROOT}/node_modules/.bin/tickets`,
    `${stalePlaceholder}/node_modules/.bin/tickets`,
    "/runtime/margot/node_modules/.bin/tickets",
  ];
  for (const command of commands) {
    const error = await captureError(() =>
      bindRequest(
        bindInput({
          config: {
            ...config,
            claude: { ...config.claude, ticketing: { ...config.claude.ticketing, command } },
          },
        }),
        readPull(),
      ),
    );
    expect((error as Error).message).toBe(
      "claude.ticketing.command runs inside the runtime container: name the image's command (such as mcp-linear), not a path under the Margot root or a placeholder",
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
it("binds the shipped sample configuration for authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-bind-"));
  directories.push(directory);
  const configFile = join(directory, "sample.json");
  await writeFile(
    configFile,
    await readFile(new URL("../../samples/config.sample.json", import.meta.url), "utf8"),
  );
  const result = await bindRequestFiles(
    { ...bindInput({ margotRoot: directory }), configFile },
    "read-token",
    { rest: { pulls: { get: async () => ({ data: pull }) } } } as never,
  );
  expect(result.config.review.publication).toBe("github");
  expect(result.config.publisher?.checks.review).toBe("review / margot");
});
it("requires GH_TOKEN before reading configuration or GitHub", async () => {
  const error = await captureError(() =>
    bindRequestFiles({ ...bindInput(), configFile: "/not-read" }, undefined),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/GH_TOKEN/);
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
    expect(result.config.github.shadowBeforeHead).toBe(true);
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
const referenceFixture = async (references: unknown) => {
  const directory = await mkdtemp(join(tmpdir(), "margot-bind-references-"));
  directories.push(directory);
  const configFile = join(directory, "trusted.json");
  await writeFile(
    configFile,
    JSON.stringify({ ...config, claude: { ...config.claude, references } }),
  );
  const lookups: unknown[] = [];
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pull }) },
      repos: {
        getCommit: async (parameters: { ref: string }) => {
          lookups.push(parameters);
          if (parameters.ref !== "v1") throw new Error("Not Found");
          return { data: { sha: "e".repeat(40) } };
        },
      },
    },
  };
  const bind = () =>
    bindRequestFiles(
      { ...bindInput({ margotRoot: directory }), configFile },
      "read-token",
      github as never,
    );
  return { directory, lookups, bind };
};
it("resolves a reference ref to its commit and writes only head", async () => {
  const fixture = await referenceFixture({ shared: { repository: "example/shared", ref: "v1" } });
  const result = await fixture.bind();
  const expected = { shared: { repository: "example/shared", head: "e".repeat(40) } };
  expect(fixture.lookups).toEqual([{ owner: "example", repo: "shared", ref: "v1" }]);
  expect(result.config.claude.references).toEqual(expected);
  expect(
    JSON.parse(await readFile(join(fixture.directory, "config.json"), "utf8")).claude.references,
  ).toEqual(expected);
});
it("fails bind-request naming the reference and ref that does not resolve", async () => {
  const fixture = await referenceFixture({ shared: { repository: "example/shared", ref: "gone" } });
  const error = await captureError(fixture.bind);
  expect(error).toBeInstanceOf(Error);
  expect(instanceExitCode(error)).toBe(1);
  expect((error as Error).message).toMatch(
    /Reference shared \(example\/shared\) ref gone did not resolve/,
  );
});
it("names the reference whose entry is malformed", async () => {
  const fixture = await referenceFixture({
    shared: { repository: "example/shared", head: "f".repeat(40) },
    broken: { repository: "example/broken" },
  });
  const error = await captureError(fixture.bind);
  expect((error as Error).message).toMatch(/^Reference broken is invalid: /);
});
it("rejects a reference that gives both head and ref, or neither", async () => {
  for (const reference of [
    { repository: "example/shared", head: "f".repeat(40), ref: "v1" },
    { repository: "example/shared" },
  ]) {
    const fixture = await referenceFixture({ shared: reference });
    const error = await captureError(fixture.bind);
    expect((error as Error).message).toMatch(/exactly one of head or ref/);
    expect(fixture.lookups).toEqual([]);
  }
});
it("rejects a reference ref that is not a conservative name", async () => {
  for (const ref of ["a b", "a..b", "-v1", ""]) {
    const fixture = await referenceFixture({ shared: { repository: "example/shared", ref } });
    expect(((await captureError(fixture.bind)) as Error).message).toMatch(/must not contain/);
    expect(fixture.lookups).toEqual([]);
  }
});
it("passes a reference that already gives head through untouched", async () => {
  const references = { shared: { repository: "example/shared", head: "f".repeat(40) } };
  const fixture = await referenceFixture(references);
  const result = await fixture.bind();
  expect(fixture.lookups).toEqual([]);
  expect(result.config.claude.references).toEqual(references);
});
it("keeps the live schema requiring head on every reference", () => {
  const live = {
    ...config,
    claude: {
      ...config.claude,
      references: { shared: { repository: "example/shared", ref: "v1" } },
    },
  };
  expect(liveConfigSchema.safeParse(live).success).toBe(false);
});
it("names the flag whose value is not valid JSON", async () => {
  const fixture = await bindCommandFixture("false");
  fixture.args[fixture.args.indexOf("--protected-paths") + 1] = "[protected/**";
  const error = await captureError(() =>
    runInstanceCommand(fixture.args, { GH_TOKEN: "read-token" }, fixture.client as never),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/^--protected-paths is not valid JSON: /);
  expect(instanceExitCode(error)).toBe(1);
});
it("prints the usage for --help without failing", async () => {
  expect(await runInstanceCommand(["--help"], {})).toEqual({
    help: expect.stringMatching(/^Usage: margot-instance /),
  });
});
it("binds a benchmark shadow run: the reviewer model overridden and no prior ledger", async () => {
  const fixture = await bindCommandFixture("false");
  await runInstanceCommand(
    [...fixture.args, "--reviewer-model", "claude-haiku-4-5", "--fresh", "true"],
    { GH_TOKEN: "read-token" },
    fixture.client as never,
  );
  const bound = JSON.parse(await readFile(join(fixture.directory, "config.json"), "utf8"));
  expect({
    reviewerModel: bound.claude.reviewerModel,
    fresh: bound.github.freshShadow,
    publication: bound.review.publication,
  }).toEqual({ reviewerModel: "claude-haiku-4-5", fresh: true, publication: "none" });
});
it("refuses a benchmark override on a run with publication authority", async () => {
  for (const extra of [
    ["--reviewer-model", "claude-haiku-4-5"],
    ["--fresh", "true"],
  ]) {
    const fixture = await bindCommandFixture("true");
    const error = await captureError(() =>
      runInstanceCommand(
        [...fixture.args, ...extra],
        { GH_TOKEN: "read-token" },
        fixture.client as never,
      ),
    );
    expect((error as Error).message).toBe(
      "--reviewer-model and --fresh are for a shadow benchmark run and cannot have --authority true",
    );
  }
});
