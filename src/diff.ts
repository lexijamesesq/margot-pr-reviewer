import parseDiff from "parse-diff";

/** Validate text inventory and hunk lengths; caller metadata is checked separately. */
export function diffIsComplete(diff: string, files = parseDiff(diff)): boolean {
  return (
    files.length === [...diff.matchAll(/^diff --git /gm)].length &&
    (!diff.trim() || files.length > 0) &&
    !/^Binary files .* differ$|^GIT binary patch$/m.test(diff) &&
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
