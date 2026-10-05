import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recordings = join(import.meta.dirname, "..", "recordings");
const prose = join(recordings, "prose");
const credentialsAndPaths =
  /\/Users\/|\/home\/|\/private\/|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-ant-|\.internal\b|\.local\b|session_[A-Za-z0-9]/;
const url = /https?:\/\/([^/\s"'`)]+)(\/[^\s"'`)]*)?/g;
const slashToken = /[\w.@-]+(?:\/[\w.@-]+)+/g;
// Slash-joined words that are prose, not repositories. Anything else slash-joined must
// be under `example/`, a file path with a known extension, or listed here.
const proseTokens = new Set([
  "0.46/0.47",
  "add/delete",
  "base/head",
  "card/risk/voice",
  "JS/TS",
  "linter/formatter",
  "packages/app",
  "pass/fail",
  "try/except",
  "repos/...",
]);
// Public third-party repositories a recording may name, because the change under review
// really does pin or call them. Each is a published project, not a private identity.
const publicThirdPartyRepositories = new Set(["ludeeus/action-shellcheck"]);
// A repository reference in any spelling: `repos/<owner>/<name>` as an API path, or
// `github.com/<owner>/<name>`. It is judged on its owner before any file-path exemption,
// because an API path ending in `README.md` is still a repository reference. An owner
// that is an ellipsis (`repos/.../rules`) is a prose placeholder and falls through.
const repositoryReference = /(?:^|\/)(?:repos|github\.com)\/(\w[\w.-]*)\/([\w.-]+)/;
const filePath = /\.(?:md|json|ya?ml|sh|py|ts|js|txt|toml)(?:@[\w.-]+)?$/;

/** Everything in a recording that could identify a real repository, host, credential or machine. */
function leaks(contents: string): string[] {
  const found: string[] = [];
  const credential = contents.match(credentialsAndPaths);
  if (credential) found.push(`credential or machine path: ${credential[0]}`);
  for (const [, host, path = ""] of contents.matchAll(url)) {
    const allowed =
      host === "example.com" || (host === "github.com" && /^\/example(\/|$)/.test(path));
    if (!allowed) found.push(`URL outside example.com or github.com/example: ${host}${path}`);
  }
  for (const raw of contents.replace(url, " ").match(slashToken) ?? []) {
    const token = raw.replace(/[.]+$/, "");
    const reference = token.match(repositoryReference);
    if (reference) {
      const [, owner = "", name = ""] = reference;
      if (owner !== "example" && !publicThirdPartyRepositories.has(`${owner}/${name}`))
        found.push(`repository outside example/: ${token}`);
      continue;
    }
    const allowed =
      token.startsWith("example/") ||
      publicThirdPartyRepositories.has(token) ||
      proseTokens.has(token) ||
      proseTokens.has(token.replace(/\/\.\.\..*$/, "/...")) ||
      filePath.test(token);
    if (!allowed) found.push(`repository outside example/: ${token}`);
  }
  return found;
}
const placeholderShas = new Set(["0123abcd", "1234abc", "2345bcd"]);

const files = (directory: string, extension: string) =>
  readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .map((name) => ({ name, contents: readFileSync(join(directory, name), "utf8") }));

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) => [key, ...strings(item)]);
  return [];
}

describe("shipped recordings carry no identifying residue", () => {
  const jsonRecordings = files(recordings, ".json");
  const proseSamples = files(prose, ".txt");

  it("audits every recording and prose sample", () => {
    expect(jsonRecordings).toHaveLength(7);
    expect(proseSamples).toHaveLength(8);
  });

  it.each(jsonRecordings)(
    "keeps identities, credentials, hosts and machine paths out of $name",
    ({ contents }) => {
      expect(leaks(contents)).toEqual([]);
      for (const value of strings(JSON.parse(contents)))
        if (value.startsWith("/"))
          expect(value).toMatch(/^\/recorded-bundle\/skills\/pr-council\/playbooks\/[a-z-]+\.md$/);
    },
  );

  it.each(proseSamples)(
    "keeps identities, PR numbers, ticket keys and real SHAs out of prose/$name",
    ({ contents }) => {
      expect(leaks(contents)).toEqual([]);
      expect(contents).not.toMatch(/#\d{2,}|\b[A-Z]{2,}-\d+\b/);
      for (const sha of contents.match(/\b[0-9a-f]{7,40}\b/g) ?? [])
        expect(placeholderShas.has(sha), `Real-looking SHA ${sha}`).toBe(true);
    },
  );
});

describe("the recordings audit", () => {
  it("accepts an example repository and example hosts", () => {
    expect(
      leaks('{"repository":"example/project","u":"https://github.com/example/project/pull/1"}'),
    ).toEqual([]);
  });
  it.each([
    ['{"repository":"acme-corp/billing-service"}', "repository outside example/"],
    [
      '{"summary":"The change in acme-corp/billing-service breaks the retry path."}',
      "repository outside example/: acme-corp/billing-service",
    ],
    ["Prose sample mentions acme-corp/billing-service here.", "repository outside example/"],
    ['"/repos/acme-corp/billing-service/pulls/3"', "repository outside example/"],
    [
      '"/repos/acme-corp/billing-service/contents/README.md"',
      "repository outside example/: repos/acme-corp/billing-service",
    ],
    [
      "see github.com/acme-corp/billing-service/blob/main/README.md",
      "repository outside example/: github.com/acme-corp/billing-service",
    ],
    ["see https://github.com/acme-corp/billing-service", "URL outside"],
    ["see https://ci.acme-corp.dev/run/9", "URL outside"],
    ["token ghp_abcdefghijklmnop", "credential"],
    ["/Users/someone/work", "machine path"],
  ])("flags a planted real-looking value: %s", (planted, expected) => {
    expect(leaks(planted).join("\n")).toContain(expected);
  });
});
