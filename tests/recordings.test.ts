import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recordings = join(import.meta.dirname, "..", "recordings");
const prose = join(recordings, "prose");
const forbidden =
  /lexijamesesq|core-skills|dotty|incubator|metrics|\/Users\/|\/home\/|\/private\/|https?:\/\/|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-ant-|\.internal\b|\.local\b|session_[A-Za-z0-9]/i;
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
      expect(contents).not.toMatch(forbidden);
      for (const value of strings(JSON.parse(contents)))
        if (value.startsWith("/"))
          expect(value).toMatch(/^\/recorded-bundle\/skills\/pr-council\/playbooks\/[a-z-]+\.md$/);
    },
  );

  it.each(proseSamples)(
    "keeps identities, PR numbers, ticket keys and real SHAs out of prose/$name",
    ({ contents }) => {
      expect(contents).not.toMatch(forbidden);
      expect(contents).not.toMatch(/#\d{2,}|\b[A-Z]{2,}-\d+\b/);
      for (const sha of contents.match(/\b[0-9a-f]{7,40}\b/g) ?? [])
        expect(placeholderShas.has(sha), `Real-looking SHA ${sha}`).toBe(true);
    },
  );
});
