import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  checkExternalId,
  checkMetadataText,
  readCheckRecord,
  reviewRequestId,
  textIdentity,
} from "../src/check-identity.js";
import { evaluateChecks, evaluateRequiredChecks } from "../src/trusted-checks.js";

const r = {
  repository: "example/project",
  pr: 7,
  base: "a".repeat(40),
  head: "b".repeat(40),
  phase: "review" as const,
  triageCheckId: 101,
  workflowRef: "v1.2.3",
};
const identity = {
  repository: r.repository,
  pr: r.pr,
  base_sha: r.base,
  head_sha: r.head,
  triage_check_id: r.triageCheckId,
  workflow_ref: r.workflowRef,
};
const digest = textIdentity("Title", "Body", "branch", "main");
const policy = {
  requiredChecks: ["ci / checks", "trusted-scan / trusted-scan"],
  requiredCheckReporters: { "ci / checks": 4862659, "trusted-scan / trusted-scan": 4862659 },
  trustedCheckActors: ["margot", "github-actions"],
  allowedSkippedChecks: ["ci / checks"],
  codeName: "ci / checks",
  textName: "trusted-scan / trusted-scan",
  workflowRef: r.workflowRef,
  controlAppId: 4862659,
};
const check = (kind: "code" | "text", id: number) => ({
  id,
  name: kind === "code" ? policy.codeName : policy.textName,
  head_sha: r.head,
  external_id: checkExternalId(r),
  details_url: "https://github.com/example/project/actions/runs/1",
  status: "completed",
  conclusion: "success",
  app: { id: 4862659, slug: "margot" },
  output: {
    text: checkMetadataText({
      version: 1,
      kind,
      ...identity,
      request_id: reviewRequestId(identity),
      phase: "complete",
      owner_run_url: "https://github.com/example/project/actions/runs/1",
      handoff: "accepted",
      ...(kind === "text" ? { text_digest: digest } : {}),
    }),
  },
});
it("filters the expected reporter before selecting newest", () => {
  const forged = {
    ...check("code", 999),
    app: { id: 15368, slug: "github-actions" },
    conclusion: "failure",
  };
  expect(
    evaluateRequiredChecks(r, policy, [check("code", 1), check("text", 2), forged], digest),
  ).toEqual({ green: true, pending: [], failing: [] });
  expect(
    evaluateRequiredChecks(
      r,
      policy,
      [{ ...forged, conclusion: "success" }, check("text", 2)],
      digest,
    ).green,
  ).toBe(false);
});
it.each([
  { conclusion: "skipped" },
  { output: { text: "missing metadata" } },
  { output: { text: 12 } },
])("fails newest owned mandatory receipt %j instead of selecting older green", (patch) => {
  expect(
    evaluateRequiredChecks(
      r,
      policy,
      [check("code", 1), check("text", 2), { ...check("code", 3), ...patch }],
      digest,
    ),
  ).toEqual({ green: false, pending: [], failing: [policy.codeName] });
});
it("rejects a current text mismatch while retaining independent code success", () => {
  expect(
    evaluateRequiredChecks(
      r,
      policy,
      [check("code", 1), check("text", 2)],
      textIdentity("Edited", "Body", "branch", "main"),
    ),
  ).toEqual({ green: false, pending: [], failing: [policy.textName] });
});
it("keeps the complete machine record when human check text is capped", () => {
  const record = readCheckRecord(check("text", 2).output.text);
  const text = checkMetadataText(record, "☃".repeat(70000));
  expect(Array.from(text).length).toBeLessThanOrEqual(60000);
  expect(readCheckRecord(text)).toEqual(record);
  expect(() => readCheckRecord(`${text}\n${checkMetadataText(record)}`)).toThrow("ambiguous");
});

const envelope = () =>
  JSON.parse(
    readFileSync(new URL("./fixtures/trusted-checks-envelope.json", import.meta.url), "utf8"),
  );
it("evaluates the authenticated live envelope and excludes its own review checks", () => {
  const input = envelope();
  input.config.review.requiredChecks.push("review / margot", "review / triage");
  expect(evaluateChecks(input)).toEqual({ green: true, pending: [], failing: [] });
});
it.each(["app", "name"])("rejects forged triage %s at the evaluator boundary", (field) => {
  const input = envelope();
  if (field === "app") input.triage.app.id = 15368;
  else input.triage.name = "untrusted triage";
  expect(() => evaluateChecks(input)).toThrow();
});
it.each(["head", "base"])("rejects a moved live pull %s at the evaluator boundary", (field) => {
  const input = envelope();
  input.pull[field].sha = "f".repeat(40);
  expect(() => evaluateChecks(input)).toThrow();
});
it.each(["ci / checks", "trusted-scan / trusted-scan"])(
  "requires the mandatory policy for %s",
  (name) => {
    const input = envelope();
    input.config.review.requiredChecks = input.config.review.requiredChecks.filter(
      (n: string) => n !== name,
    );
    expect(() => evaluateChecks(input)).toThrow("Mandatory App reporter policy required");
    const wrongReporter = envelope();
    wrongReporter.config.review.requiredCheckReporters[name] = 15368;
    expect(() => evaluateChecks(wrongReporter)).toThrow("Mandatory App reporter policy required");
  },
);
