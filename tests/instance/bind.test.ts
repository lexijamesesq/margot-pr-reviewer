import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bindRequest, bindRequestFiles } from "../../src/instance.js";
import { instanceExitCode, runInstanceCommand } from "../../src/instance-cli.js";
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
