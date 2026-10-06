import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { bundleSchema, cardNames, shaSchema } from "../schemas.js";
import type { CallContext } from "../types.js";
import { execute } from "./process.js";

export async function resolveBundle(directory: string, commit: string, context: CallContext) {
  shaSchema.parse(commit);
  const root = await realpath(directory);
  const git = (args: string[]) => execute("git", ["-C", root, ...args], context);
  if ((await git(["rev-parse", "HEAD"])).trim() !== commit)
    throw new Error("Card bundle pin mismatch");
  if ((await git(["status", "--porcelain", "--untracked-files=all"])).trim())
    throw new Error("Card bundle is dirty");
  const paths = [
    ".claude-plugin/plugin.json",
    "agents/pr-reviewer.md",
    "agents/margot.md",
    "skills/pr-council/SKILL.md",
    ...cardNames.map((n) => `skills/pr-council/playbooks/${n}.md`),
  ];
  for (const path of paths) {
    const absolute = join(root, path);
    if (!(await lstat(absolute)).isFile() || (await realpath(absolute)) !== absolute)
      throw new Error("Bundle file is not a regular pinned file");
    await git(["ls-files", "--error-unmatch", path]);
  }
  return bundleSchema.parse({
    commit,
    reviewerAgent: "publish:pr-reviewer",
    voiceAgent: "publish:margot",
  });
}
/**
 * The base checkout the reviewers read at /work must be the request's base commit of the
 * request's repository, clean, as the card bundle is checked against its pin.
 */
export async function verifyBaseCheckout(
  directory: string,
  repository: string,
  base: string,
  context: CallContext,
) {
  const git = (args: string[]) => execute("git", ["-C", directory, ...args], context);
  const remote = (await git(["remote", "get-url", "origin"]).catch(() => ""))
    .trim()
    .match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i)?.[1];
  if (
    (await git(["rev-parse", "HEAD"]).catch(() => "")).trim() !== base ||
    (await git(["status", "--porcelain", "--untracked-files=all"]).catch(() => "x")).trim() ||
    remote?.toLowerCase() !== repository.toLowerCase()
  )
    throw new Error("Base checkout mismatch");
}
