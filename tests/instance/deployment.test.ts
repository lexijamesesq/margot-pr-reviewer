import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type DeploymentSelection, validateDeployment } from "../../src/instance.js";
import { runInstanceCommand } from "../../src/instance-cli.js";
import { captureError, deployment, directories, route } from "../helpers/instance.js";

it("accepts the exact configured release and records authority", () => {
  let selected: DeploymentSelection | undefined;
  expect(() => {
    selected = validateDeployment(route({}));
  }).not.toThrow();
  expect(selected).toEqual({ authority: true, repositoryName: "project" });
});
it.each([
  [
    "rejects a release asset from a different repository",
    { releaseRepository: "other/margot-pr-reviewer" },
  ],
  [
    "rejects disagreement among deployment and asset versions",
    {
      deployment: {
        ...deployment,
        packageReference: deployment.packageReference.replaceAll("0.6.1", "0.6.2"),
      },
    },
  ],
  ["requires the bootstrap SHA-256", { deployment: { ...deployment, packageSha256: undefined } }],
  ["rejects an unenrolled target", { repository: "example/outside" }],
  ["rejects authority outside enrolment", { authorityRepositories: ["example/outside"] }],
] as const)("%s", (_name, invalid) => {
  expect(() => validateDeployment(route(invalid))).toThrow();
});
it.each([
  ["rejects a non-HTTPS release asset", "http://github.com"],
  ["rejects a release asset from another host", "https://example.com"],
  ["rejects a release asset with an explicit port", "https://github.com:444"],
  ["rejects a release asset with credentials", "https://user@github.com"],
] as const)("%s", (_name, replacement) => {
  const packageReference = replacement.includes("margot-pr-reviewer-0.6.1.tgz")
    ? replacement
    : deployment.packageReference.replace("https://github.com", replacement);
  expect(() =>
    validateDeployment(
      route({
        deployment: { ...deployment, packageReference },
      }),
    ),
  ).toThrow();
});
it("returns false authority for an enrolled shadow", () => {
  const input: string[] = [];
  expect(validateDeployment(route({ authorityRepositories: input })).authority).toBe(false);
});
it("parses the strict deployment command and emits its outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-command-"));
  directories.push(directory);
  const deploymentFile = join(directory, "deployment.json");
  const output = join(directory, "output");
  await writeFile(deploymentFile, JSON.stringify(deployment));
  await writeFile(output, "prior=value\n");
  const args = [
    "validate-deployment",
    "--deployment",
    deploymentFile,
    "--release-repository",
    "example/margot-pr-reviewer",
    "--repository",
    "example/project",
    "--enrolled-repositories",
    '["example/project"]',
    "--authority-repositories",
    '["example/project"]',
  ];
  expect(await runInstanceCommand(args, { GITHUB_OUTPUT: output })).toEqual({
    authority: true,
    repositoryName: "project",
  });
  expect(await readFile(output, "utf8")).toBe(
    "prior=value\nauthority=true\nrepositoryName=project\n",
  );
});
it("rejects duplicate flags after parseArgs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "margot-command-duplicate-"));
  directories.push(directory);
  const deploymentFile = join(directory, "deployment.json");
  await writeFile(deploymentFile, JSON.stringify(deployment));
  const args = [
    "validate-deployment",
    "--deployment",
    deploymentFile,
    "--release-repository",
    "example/margot-pr-reviewer",
    "--repository",
    "example/project",
    "--enrolled-repositories",
    '["example/project"]',
    "--authority-repositories",
    '["example/project"]',
  ];
  args.push("--repository", "example/shadow");
  const error = await captureError(() => runInstanceCommand(args, {}));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Duplicate argument: --repository");
});
