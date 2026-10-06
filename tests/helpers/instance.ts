import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BindRequestInput } from "../../src/instance.js";

export const margotRootPlaceholder = `\${MARGOT_ROOT}`;
export const stalePlaceholder = `\${OLD_ROOT}`;
export const head = "a".repeat(40);
export const base = "b".repeat(40);
export const deployment = {
  version: "0.6.1",
  packageReference:
    "https://github.com/example/margot-pr-reviewer/releases/download/v0.6.1/margot-pr-reviewer-0.6.1.tgz",
  packageIntegrity: `sha512-${"A".repeat(86)}==`,
  packageSha256: "c".repeat(64),
};
export const route = (overrides: Record<string, unknown> = {}) => ({
  deployment,
  releaseRepository: "example/margot-pr-reviewer",
  repository: "example/project",
  enrolledRepositories: ["example/project", "example/shadow"],
  authorityRepositories: ["example/project"],
  ...overrides,
});
export const config = {
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
    container: {
      image: `registry.example/margot-runtime@sha256:${"0".repeat(64)}`,
      work: `${margotRootPlaceholder}/base`,
    },
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
export const pull = {
  state: "open",
  merged: false,
  draft: false,
  mergeable: true,
  changed_files: 1,
  base: { sha: base },
  head: { sha: head, repo: { full_name: "example/project" } },
};
export const bindInput = (overrides: Partial<BindRequestInput> = {}): BindRequestInput => ({
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
export const readPull =
  (value: unknown = pull) =>
  async () =>
    value;
export const directories: string[] = [];
export async function captureError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return undefined;
}
export async function bindCommandFixture(authority: "true" | "false" = "false") {
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
export function closeCommandArgs(overrides: Record<string, string> = {}) {
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
export function closeCommandClient(options: { failPulls?: boolean; calls?: string[] } = {}) {
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
