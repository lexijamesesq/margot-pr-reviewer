import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { runInstanceCommand } from "../../src/instance-cli.js";
import { base, captureError, head } from "../helpers/instance.js";

type File = { filename: string; previous_filename?: string; status?: string };
/** A GitHub that serves one PR's files and checks and records every check-run it is sent. */
function gitHub(
  options: { files: File[]; triage?: string | null; triageSlug?: string; prHead?: string } = {
    files: [],
  },
) {
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
    if (target.pathname === "/repos/example/project/pulls/7")
      return reply({ head: { sha: options.prHead ?? head }, base: { sha: base } });
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
