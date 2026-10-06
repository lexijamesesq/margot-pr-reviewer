import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { runInstanceCommand } from "../../src/instance-cli.js";
import { base, captureError, head } from "../helpers/instance.js";

type File = { filename: string; previous_filename?: string; status?: string };
/** A GitHub that serves one PR's files and checks and records every check-run it is sent. */
/** One complete diff section per file: an edit, or a pure rename. */
const diffOf = (files: File[]) =>
  files
    .map((f) =>
      f.previous_filename
        ? `diff --git a/${f.previous_filename} b/${f.filename}\nsimilarity index 100%\nrename from ${f.previous_filename}\nrename to ${f.filename}\n`
        : `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n@@ -1 +1 @@\n-old\n+new\n`,
    )
    .join("");
function gitHub(
  options: {
    files: File[];
    triage?: string | null;
    triageSlug?: string;
    prHead?: string;
    /** The whole-PR diff GitHub serves; by default the files' own. */
    diff?: string;
    /** The head a second read of the PR reports. */
    headAfter?: string;
  } = {
    files: [],
  },
) {
  let pullReads = 0;
  const posts: { token: string; body: Record<string, unknown> }[] = [];
  const triageText =
    options.triage === null
      ? undefined
      : JSON.stringify({
          head_sha: head,
          decision_source: "jev",
          classification: options.triage ?? "functional",
        });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    const method = init?.method ?? "GET";
    const reply = (data: unknown, status = 200) => {
      const response = new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(response, "url", { value: target.href });
      return response;
    };
    if (method === "POST" && target.pathname === "/repos/example/project/check-runs") {
      posts.push({
        token: new Headers(init?.headers).get("authorization") ?? "",
        body: JSON.parse(String(init?.body)),
      });
      return reply({ id: 1 }, 201);
    }
    if (target.pathname === "/repos/example/project/pulls/7") {
      if (new Headers(init?.headers).get("accept")?.includes("diff")) {
        const response = new Response(options.diff ?? diffOf(options.files), {
          headers: { "content-type": "text/plain" },
        });
        Object.defineProperty(response, "url", { value: target.href });
        return response;
      }
      pullReads++;
      return reply({
        head: {
          sha: pullReads > 1 && options.headAfter ? options.headAfter : (options.prHead ?? head),
        },
        base: { sha: base },
      });
    }
    if (target.pathname === "/repos/example/project/pulls/7/files") return reply(options.files);
    if (target.pathname === `/repos/example/project/commits/${head}/check-runs`)
      return reply({
        total_count: triageText ? 1 : 0,
        check_runs: triageText
          ? [
              {
                id: 5,
                name: "review / triage",
                status: "completed",
                head_sha: head,
                started_at: "2026-10-06T00:00:00Z",
                app: { id: 42, slug: options.triageSlug ?? "triage" },
                output: { text: triageText },
              },
            ]
          : [],
      });
    return reply({ message: "not found" }, 404);
  }) as typeof fetch;
  const client = (token: string) =>
    new Octokit({
      auth: token,
      request: { fetch: fetcher },
      retry: { enabled: false },
      throttle: { enabled: false },
    });
  return { posts, client };
}
const args = (overrides: Record<string, string> = {}) => [
  "self-instrument",
  ...Object.entries({
    repository: "example/project",
    pr: "7",
    head,
    "protected-paths": JSON.stringify([".github/**", "rulesets/**"]),
    "app-id": "42",
    "trusted-triage-actors": JSON.stringify(["triage"]),
    ...overrides,
  }).flatMap(([name, value]) => [`--${name}`, value]),
];
const environment = { GH_TOKEN: "read-token", MARGOT_WRITE_TOKEN: "write-token" };
async function post(github: ReturnType<typeof gitHub>, overrides: Record<string, string> = {}) {
  await runInstanceCommand(args(overrides), environment, undefined, github.client);
  return github.posts;
}

it("holds a functional change to a protected path with the previous reviewer's text", async () => {
  const github = gitHub({
    files: [{ filename: "rulesets/default.json" }, { filename: ".github/workflows/ci.yml" }],
  });
  const [posted] = await post(github);
  expect(posted).toEqual({
    token: "token write-token",
    body: {
      name: "review / self-instrument",
      head_sha: head,
      status: "completed",
      conclusion: "neutral",
      output: {
        title: "self-instrument: held for the operator's approval",
        summary:
          "This PR changes Margot's own config, the estate ownership map, or a gate workflow — a surface that could disarm the gate. Margot does not approve it herself; it merges on the operator's approval.\n\nMatched:\n- `.github/workflows/ci.yml`\n- `rulesets/default.json`",
      },
    },
  });
});
it("clears a mechanical change to a protected path, naming the verified class", async () => {
  const github = gitHub({
    files: [{ filename: ".github/workflows/ci.yml" }],
    triage: "mechanical",
  });
  const [posted] = await post(github);
  expect(posted?.body).toMatchObject({
    conclusion: "success",
    output: {
      title: "self-instrument: clear",
      summary: "No functional change to a protected path (class: mechanical).",
    },
  });
});
it("holds a protected rename in every class", async () => {
  const github = gitHub({
    files: [{ filename: "docs/ci.yml", previous_filename: ".github/workflows/ci.yml" }],
    triage: "mechanical",
  });
  const [posted] = await post(github);
  expect(posted?.body).toMatchObject({ conclusion: "neutral" });
});
it("reads a change as functional without a verified triage for the head", async () => {
  for (const github of [
    gitHub({ files: [{ filename: "src/a.ts" }], triage: null }),
    gitHub({ files: [{ filename: "src/a.ts" }], triage: "mechanical", triageSlug: "someone" }),
  ]) {
    const [posted] = await post(github);
    expect(posted?.body).toMatchObject({
      conclusion: "success",
      output: { summary: "No functional change to a protected path (class: functional)." },
    });
  }
});
it("posts with a custom check name and caps the summary at 900 characters", async () => {
  const files = Array.from({ length: 80 }, (_, i) => ({
    filename: `.github/workflows/w${i}.yml`,
  }));
  const [posted] = await post(gitHub({ files }), { "check-name": "custom / authority" });
  const output = posted?.body.output as { summary: string };
  expect({ name: posted?.body.name, length: Array.from(output.summary).length }).toEqual({
    name: "custom / authority",
    length: 900,
  });
});
it("refuses a moved head and posts nothing", async () => {
  const github = gitHub({ files: [], prHead: "f".repeat(40) });
  const error = await captureError(() =>
    runInstanceCommand(args(), environment, undefined, github.client),
  );
  expect({ message: (error as Error).message, posts: github.posts }).toEqual({
    message: "PR head moved: the self-instrument check is for the live head only",
    posts: [],
  });
});
it("holds a protected path the diff names even when GitHub's file listing omits it", async () => {
  const github = gitHub({
    files: [{ filename: "src/a.ts" }],
    diff: diffOf([{ filename: "src/a.ts" }, { filename: ".github/workflows/ci.yml" }]),
  });
  const [posted] = await post(github);
  expect(posted?.body).toMatchObject({
    conclusion: "neutral",
    output: { summary: expect.stringContaining("- `.github/workflows/ci.yml`") },
  });
});
it("holds, never clears, when the change cannot be read completely", async () => {
  const github = gitHub({
    files: [{ filename: "src/a.ts" }],
    diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,5 +1,5 @@\n-old\n",
  });
  const [posted] = await post(github);
  expect(posted?.body).toMatchObject({
    conclusion: "neutral",
    output: {
      title: "self-instrument: held for the operator's approval",
      summary: expect.stringContaining("could not be read completely"),
    },
  });
});
it("refuses a head that moves while the change is read, and posts nothing", async () => {
  const github = gitHub({ files: [{ filename: "src/a.ts" }], headAfter: "f".repeat(40) });
  const error = await captureError(() =>
    runInstanceCommand(args(), environment, undefined, github.client),
  );
  expect({ message: (error as Error).message, posts: github.posts }).toEqual({
    message: "PR head moved: the self-instrument check is for the live head only",
    posts: [],
  });
});
