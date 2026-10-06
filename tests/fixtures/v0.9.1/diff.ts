import parseDiff from "parse-diff";

/**
 * Validate text inventory and hunk lengths; caller metadata is checked separately.
 * A binary file appears as its own section with no text hunks ("Binary files … differ" or an
 * encoded "GIT binary patch"); listing the path is enough to call it complete.
 */
export function diffIsComplete(diff: string, files = parseDiff(diff)): boolean {
  return (
    files.length === [...diff.matchAll(/^diff --git /gm)].length &&
    (!diff.trim() || files.length > 0) &&
    files.every((file) =>
      file.chunks.every(
        (chunk) =>
          chunk.changes.filter((c) => c.type !== "add" && !c.content.startsWith("\\")).length ===
            chunk.oldLines &&
          chunk.changes.filter((c) => c.type !== "del" && !c.content.startsWith("\\")).length ===
            chunk.newLines,
      ),
    )
  );
}

/** Every newline counts, including headers and context. */
export function diffLineCount(diff: string): number {
  return diff.split("\n").length - 1;
}
