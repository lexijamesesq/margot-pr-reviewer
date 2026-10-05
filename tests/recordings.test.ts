import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recordings = join(import.meta.dirname, "..", "recordings");
const prose = join(recordings, "prose");
const credentialsAndPaths =
  /\/Users\/|\/home\/|\/private\/|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-ant-|\.internal\b|\.local\b|session_[A-Za-z0-9]/;
const repositoryKey = /"(?:repository|repo|fullName|full_name|nameWithOwner)"\s*:\s*"([^"]*)"/g;
const apiRepositoryPath = /\brepos\/([A-Za-z0-9][\w.-]*\/[\w.-]+)/g;
const url = /https?:\/\/([^/\s"'`)]+)(\/[^\s"'`)]*)?/g;

/** Everything in a recording that could identify a real repository, host, credential or machine. */
function leaks(contents: string): string[] {
  const found: string[] = [];
  const credential = contents.match(credentialsAndPaths);
  if (credential) found.push(`credential or machine path: ${credential[0]}`);
  const names = [
    ...[...contents.matchAll(repositoryKey)].map((m) => m[1] ?? ""),
    ...[...contents.matchAll(apiRepositoryPath)].map((m) => m[1] ?? ""),
  ];
  for (const name of names)
    if (!/^example\/[A-Za-z0-9._-]+$/.test(name))
      found.push(`repository outside example/: ${name}`);
  for (const [, host, path = ""] of contents.matchAll(url)) {
    const allowed =
      host === "example.com" || (host === "github.com" && /^\/example(\/|$)/.test(path));
    if (!allowed) found.push(`URL outside example.com or github.com/example: ${host}${path}`);
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
  it("passes an example repository and example hosts", () => {
    expect(
      leaks('{"repository":"example/project","u":"https://github.com/example/project/pull/1"}'),
    ).toEqual([]);
  });
  it.each([
    ['{"repository":"acme-corp/billing-service"}', "repository outside example/"],
    ['"/repos/acme-corp/billing-service/pulls/3"', "repository outside example/"],
    ["see https://github.com/acme-corp/billing-service", "URL outside"],
    ["see https://ci.acme-corp.dev/run/9", "URL outside"],
    ["token ghp_abcdefghijklmnop", "credential"],
    ["/Users/someone/work", "machine path"],
  ])("fails on a planted real-looking value: %s", (planted, expected) => {
    expect(leaks(planted).join("\n")).toContain(expected);
  });
});
