import { canonicalize } from "./canonical.js";
import type { GitHubRead, GoldenExpected } from "./types.js";

function distinctSet(values: readonly unknown[]): string[] {
  return [...new Set(values.map(canonicalize))].sort();
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

export function compareGolden(actual: GoldenExpected, expected: GoldenExpected): string[] {
  const mismatches: string[] = [];
  if (actual.schema !== expected.schema) mismatches.push("schema");
  if (actual.id !== expected.id) mismatches.push("id");
  if (
    canonicalize(distinctSet(actual.model_requests ?? [])) !==
    canonicalize(distinctSet(expected.model_requests ?? []))
  )
    mismatches.push("model_requests");
  if (
    canonicalize(distinctSet(actual.jev_requests ?? [])) !==
    canonicalize(distinctSet(expected.jev_requests ?? []))
  )
    mismatches.push("jev_requests");
  if (!equalJson(actual.github.writes, expected.github.writes)) {
    mismatches.push("github.writes");
  }
  for (const field of ["emit", "driver", "poster", "outcome"] as const) {
    if (!equalJson(actual[field] ?? null, expected[field] ?? null)) mismatches.push(field);
  }
  return mismatches;
}

export function findGitHubRead(
  reads: readonly GitHubRead[],
  request: Pick<GitHubRead, "method" | "path" | "params">,
): GitHubRead {
  const found = reads.find(
    (entry) =>
      entry.method === request.method &&
      entry.path === request.path &&
      equalJson(entry.params, request.params),
  );
  if (!found) {
    throw new Error(
      `missing GitHub read: ${request.method} ${request.path} ${canonicalize(request.params)}`,
    );
  }
  return found;
}
