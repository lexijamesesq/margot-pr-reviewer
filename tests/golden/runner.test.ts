import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { canonicalize } from "../../src/contract/canonical.js";
import { compareGolden, findGitHubRead } from "../../src/contract/compare.js";
import type { Expected, Seam } from "../../src/contract/types.js";
import { readGoldenCase, readGoldenExpected } from "../../src/contract/validate.js";

const PORTED: ReadonlySet<Seam> = new Set();
const casesRoot = new URL("cases/", import.meta.url).pathname;
const caseIds = readdirSync(casesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("golden cases", () => {
  for (const directory of caseIds) {
    const fixture = readGoldenCase(join(casesRoot, directory, "case.json"));
    readGoldenExpected(join(casesRoot, directory, "expected.json"));
    const missing = fixture.seams.filter((seam) => !PORTED.has(seam));
    const name = `${fixture.id} [missing seams: ${missing.join(", ")}]`;
    if (missing.length > 0) {
      test.todo(name);
    } else {
      test(name, () => {
        throw new Error("all seams are marked ported, but no engine adapter exists");
      });
    }
  }
});

describe("runner self-tests", () => {
  test("PORTED starts empty and all 70 cases are represented", () => {
    expect(PORTED.size).toBe(0);
    expect(caseIds).toHaveLength(70);
  });

  test("canonicalization matches the documented worked example", () => {
    const input = {
      z: [1.0000000001],
      risk: { tail: 0.30000000004, safe: true, R: 1.0 },
    };
    expect(canonicalize(input)).toBe('{"risk":{"R":1,"safe":true,"tail":0.3},"z":[1]}');
  });

  test("canonicalization sorts object keys by code point", () => {
    expect(canonicalize({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  test("the comparator catches a byte-exact rendered-string mismatch", () => {
    const expected: Expected = {
      schema: "contract/1",
      id: "self-test",
      github: {
        writes: [{ method: "POST", path: "checks", body: { text: "line\n" }, token: "WRITE" }],
      },
    };
    const actual: Expected = {
      ...expected,
      github: {
        writes: [{ method: "POST", path: "checks", body: { text: "line" }, token: "WRITE" }],
      },
    };
    expect(compareGolden(actual, expected)).toContain("github.writes");
  });

  test("the comparator does not round outcome triage numbers", () => {
    const expected: Expected = {
      schema: "contract/1",
      id: "self-test",
      github: { writes: [] },
      outcome: { status: "reviewed", triage: { p: 0.3 } },
    };
    const actual: Expected = {
      ...expected,
      outcome: { status: "reviewed", triage: { p: 0.1 + 0.2 } },
    };
    expect(compareGolden(actual, expected)).toContain("outcome");
  });

  test("GitHub reads are an order-free store and missing data fails", () => {
    const fixture = readGoldenCase(join(casesRoot, caseIds[0] ?? "", "case.json"));
    const request = fixture.github.reads[0];
    expect(request).toBeDefined();
    if (!request) throw new Error("self-test fixture has no GitHub read");
    expect(findGitHubRead([...fixture.github.reads].reverse(), request)).toBe(request);
    expect(() =>
      findGitHubRead(fixture.github.reads, {
        method: "GET",
        path: "missing",
        params: {},
      }),
    ).toThrow("missing GitHub read");
  });
});
