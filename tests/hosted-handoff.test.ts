import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  boundIdentity,
  checkMetadataText,
  readCheckRecord,
  reviewRequestId,
} from "../src/check-identity.js";
import { hostedFixture } from "./helpers/trusted-checks.js";

it("refreshes text after classification, dispatches once, and records paired code outcome", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  f.pull.title = "Edited while classifying";
  const passed = await f.operate("code", "code-passed", { result: f.classify });
  expect(await readFile(passed.text_file, "utf8")).toContain("Edited while classifying");
  expect(await f.operate("code", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "accepted",
    retryable: false,
  });
  expect(f.dispatches).toBe(1);
  const code = [...f.checks.values()].find((c) => c.name === "ci / checks");
  if (!code) throw new Error("missing code check");
  expect(code.conclusion).toBe("success");
  expect(readCheckRecord((code.output as { text: string }).text)).toMatchObject({
    phase: "complete",
    handoff: "accepted",
  });
});
it("text correction overlaps code but never competes for initial dispatch", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("text", "begin");
  await f.operate("code", "code-passed", { result: f.classify });
  const code = JSON.parse(await readFile(join(f.directory, "code.json"), "utf8")),
    text = JSON.parse(await readFile(join(f.directory, "text.json"), "utf8"));
  expect(code.textCheckId).not.toBe(text.textCheckId);
  let completed = false;
  f.state.onSleep = async () => {
    if (!completed) {
      completed = true;
      await f.operate("code", "finish", { textOutcome: "success" });
    }
  };
  expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "accepted",
    retryable: false,
  });
  expect(f.dispatches).toBe(1);
});
it("metadata wait is bounded to 30 seconds with no dispatch or classification", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("text", "begin");
  expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "failed",
    retryable: true,
  });
  expect(f.elapsed).toBe(30000);
  expect(f.dispatches).toBe(0);
});
it("scan-time text movement prevents handoff without erasing passed code", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("code", "code-passed", { result: f.classify });
  f.pull.body = "New text";
  expect(await f.operate("code", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "not_sent_text_failed",
    retryable: true,
  });
  expect(f.dispatches).toBe(0);
  expect([...f.checks.values()].find((c) => c.name === "ci / checks")?.conclusion).toBe("success");
});
it("lost dispatch response is uncertain and never automatically repeated", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("code", "code-passed", { result: f.classify });
  f.state.dispatchError = new Error("timeout");
  expect(await f.operate("code", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "uncertain",
    retryable: true,
  });
  expect(f.dispatches).toBe(1);
  await f.operate("code", "fail");
  expect([...f.checks.values()].find((c) => c.name === "ci / checks")?.conclusion).toBe("success");
  await f.operate("text", "begin");
  expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "accepted",
    retryable: false,
  });
  expect(f.dispatches).toBe(1);
});
it("partial begin preserves the confirmed code ID for safe cleanup", async () => {
  const f = await hostedFixture();
  f.state.failTextCreate = true;
  await expect(f.operate("code", "begin")).rejects.toThrow("text create failed");
  await f.operate("code", "fail");
  expect([...f.checks.values()].find((c) => c.name === "ci / checks")?.conclusion).toBe("failure");
});
it("an old native attempt cannot publish or clean up replacement work", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  f.state.attempt = 2;
  const before = f.writes.length;
  await expect(f.operate("code", "fail")).rejects.toThrow("superseded");
  expect(f.writes).toHaveLength(before);
});
it("confirmed failed native work permits one metadata retry after a lost response", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("code", "code-passed", { result: f.classify });
  f.state.dispatchError = new Error("lost response");
  await f.operate("code", "finish", { textOutcome: "success" });
  await f.operate("code", "fail");
  f.state.dispatchError = undefined;
  f.state.nativeStatus = "completed";
  f.state.nativeConclusion = "failure";
  await f.operate("text", "begin");
  expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "accepted",
    retryable: false,
  });
  expect(f.dispatches).toBe(2);
});
it("a same-named branch run at another commit cannot authorize active reuse", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("code", "code-passed", { result: f.classify });
  await f.operate("code", "finish", { textOutcome: "success" });
  f.state.nativeSha = "d".repeat(40);
  await f.operate("text", "begin");
  expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "uncertain",
    retryable: true,
  });
  expect(f.dispatches).toBe(1);
});
it("aborts an unresponsive initial code reread at the complete metadata deadline", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("text", "begin");
  f.state.hangCodeRead = true;
  vi.useFakeTimers();
  try {
    const result = f.operate("text", "finish", { textOutcome: "success" });
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(30000);
    expect(await result).toMatchObject({ disposition: "failed", retryable: true });
    expect(f.state.abortedReads).toBe(1);
    expect(f.dispatches).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("preserves prior uncertain intent across a crash in the intermediate text rewrite", async () => {
  const f = await hostedFixture();
  await f.operate("code", "begin");
  await f.operate("code", "code-passed", { result: f.classify });
  await f.operate("code", "finish", { textOutcome: "failure" });
  const begun = await f.operate("text", "begin");
  const text = f.checks.get(begun.text_check_id as number);
  if (!text) throw new Error("missing text");
  text.output = {
    text: checkMetadataText({
      ...readCheckRecord((text.output as { text: string }).text),
      triage_check_id: 101,
      request_id: reviewRequestId(boundIdentity({ ...f.request, triageCheckId: 101 }, "v0.10.0")),
      phase: "text_passed",
      handoff: "uncertain",
    }),
  };
  f.state.nativeVisible = false;
  f.state.failAfterTextPassed = true;
  await expect(f.operate("text", "finish", { textOutcome: "success" })).rejects.toThrow(
    "interrupted after text write",
  );
  const saved = f.checks.get(begun.text_check_id as number);
  if (!saved) throw new Error("missing text");
  expect(readCheckRecord((saved.output as { text: string }).text).handoff).toBe("uncertain");
  f.state.failAfterTextPassed = false;
  expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
    disposition: "uncertain",
    retryable: true,
  });
  expect(f.dispatches).toBe(0);
});
for (const contradictory of [false, true])
  it(`deliberate rerun recovers unknown acceptance without bypassing contradictory evidence (${contradictory})`, async () => {
    const f = await hostedFixture();
    await f.operate("code", "begin");
    await f.operate("code", "code-passed", { result: f.classify });
    f.state.dispatchError = new Error("lost response");
    await f.operate("code", "finish", { textOutcome: "success" });
    f.state.dispatchError = undefined;
    f.state.nativeVisible = contradictory;
    f.state.nativeActor = contradictory ? "untrusted[bot]" : "margot[bot]";
    await f.operate("text", "begin");
    expect(await f.operate("text", "finish", { textOutcome: "success" })).toMatchObject({
      disposition: "uncertain",
      retryable: true,
    });
    expect(f.dispatches).toBe(1);
    f.state.attempt = 2;
    const rerun = {
      config: {
        ...f.config,
        publisher: {
          ...f.config.publisher,
          runUrl: "https://github.com/example/project/actions/runs/2/attempts/2",
        },
      },
    };
    await f.operate("text", "begin", rerun);
    expect(await f.operate("text", "finish", { ...rerun, textOutcome: "success" })).toMatchObject({
      disposition: contradictory ? "uncertain" : "accepted",
      retryable: contradictory,
    });
    expect(f.dispatches).toBe(contradictory ? 1 : 2);
    await expect(f.operate("text", "finish", { ...rerun, textOutcome: "success" })).rejects.toThrow(
      "terminal",
    );
    expect(f.dispatches).toBe(contradictory ? 1 : 2);
  });
