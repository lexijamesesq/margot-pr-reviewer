import type { Octokit } from "octokit";
import type { z } from "zod";
import { checkText } from "../render.js";
import { publisherSchema, requestSchema } from "../schemas.js";
import type { CallContext, ReviewRequest, ReviewResult, Services } from "../types.js";

/** Adopt the caller check by App/name/head; its run URL fences superseded writers. */
export function githubPublisher(client: Octokit, input: z.infer<typeof publisherSchema>) {
  const config = publisherSchema.parse(input);
  const ids = new Map<string, number>();
  let active: ReviewRequest | undefined;
  let approvalId: number | undefined;
  const params = (r: ReviewRequest, c: CallContext) => {
    requestSchema.parse(r);
    const [owner = "", repo = ""] = r.repository.split("/");
    return { owner, repo, pull_number: r.pr, request: { signal: c.signal } };
  };
  async function assertCurrentRun(r: ReviewRequest, c: CallContext) {
    const primary = active?.phase === "triage" ? config.checks.triage : config.checks.review;
    const id = ids.get(primary);
    if (id) {
      const owned = (await client.rest.checks.get({ ...params(r, c), check_run_id: id })).data;
      if (
        owned.details_url !== config.runUrl ||
        owned.head_sha !== r.head ||
        owned.app?.id !== config.appId
      )
        throw new Error("Publication superseded by another run");
    }
  }
  async function guard(r: ReviewRequest, c: CallContext, allowMerged = false) {
    const { data } = await client.rest.pulls.get(params(r, c));
    await assertCurrentRun(r, c);
    const merged = allowMerged && data.merged;
    if (
      (!merged && (data.state !== "open" || data.base.sha !== r.base)) ||
      data.draft ||
      data.head.repo?.full_name !== r.repository ||
      data.head.sha !== r.head
    )
      throw new Error("Publication refused: admission or revision changed");
    return data;
  }
  async function check(
    r: ReviewRequest,
    name: string,
    conclusion: "success" | "neutral" | "action_required" | null,
    title: string,
    summary: string,
    text: string | undefined,
    c: CallContext,
  ) {
    await guard(r, c);
    const payload = {
      ...params(r, c),
      name,
      head_sha: r.head,
      details_url: config.runUrl,
      status: conclusion ? ("completed" as const) : ("in_progress" as const),
      ...(conclusion ? { conclusion } : {}),
      output: { title, summary, ...(text ? { text } : {}) },
    };
    let id = ids.get(name);
    if (!id) {
      const checks = await client.paginate(client.rest.checks.listForRef, {
        ...params(r, c),
        ref: r.head,
        per_page: 100,
        filter: "latest",
        app_id: config.appId,
      });
      const existing = checks
        .filter((v) => v.name === name && v.head_sha === r.head && v.app?.id === config.appId)
        .sort((a, b) => b.id - a.id)[0];
      // A same-head retry finds the previous run's check already completed. GitHub does
      // not reopen a completed check-run, so a retry opens a new one rather than
      // failing on the readback of a PATCH that could not take.
      if (existing && !(payload.status === "in_progress" && existing.status === "completed"))
        id = existing.id;
    }
    const { data } = id
      ? await client.rest.checks.update({ ...payload, check_run_id: id })
      : await client.rest.checks.create(payload);
    // Save a valid ID even if other response fields are wrong, for error cleanup.
    if (Number.isSafeInteger(data.id)) ids.set(name, data.id);
    const mismatches = [
      !Number.isSafeInteger(data.id) || data.id <= 0 ? "id" : "",
      data.head_sha !== r.head ? `head_sha=${data.head_sha}` : "",
      data.name !== name ? `name=${data.name}` : "",
      data.app?.id !== config.appId ? `app=${data.app?.id}` : "",
      data.status !== payload.status ? `status=${data.status}` : "",
      conclusion && data.conclusion !== conclusion ? `conclusion=${data.conclusion}` : "",
    ].filter(Boolean);
    if (mismatches.length)
      throw new Error(`Invalid check write receipt for ${name}: ${mismatches.join(", ")}`);
  }
  async function withdraw(r: ReviewRequest, c: CallContext) {
    const reviews = await client.paginate(client.rest.pulls.listReviews, {
      ...params(r, c),
      per_page: 100,
    });
    const owned = reviews.filter(
      (v) => v.user?.login === config.actor && v.user.type === "Bot" && v.state === "APPROVED",
    );
    // An ambiguous approval response is also compensated when its ID was received.
    const reviewIds = new Set([...owned.map((v) => v.id), ...(approvalId ? [approvalId] : [])]);
    for (const review_id of reviewIds) {
      await assertCurrentRun(r, c);
      const { data } = await client.rest.pulls.dismissReview({
        ...params(r, c),
        review_id,
        message: "A new review must establish clearance for this head.",
      });
      if (data.state !== "DISMISSED") throw new Error("Approval dismissal was not confirmed");
    }
    approvalId = undefined;
  }
  async function confirmReviewCheck(r: ReviewRequest, conclusion: string, c: CallContext) {
    const id = ids.get(config.checks.review);
    if (!id) throw new Error("Review check was not completed before approval");
    const { data } = await client.rest.checks.get({ ...params(r, c), check_run_id: id });
    if (
      data.status !== "completed" ||
      data.conclusion !== conclusion ||
      data.head_sha !== r.head ||
      data.app?.id !== config.appId
    )
      throw new Error("Review check was not confirmed before approval");
  }
  const disableAutoMerge: Services["disableAutoMerge"] = async (r, c) => {
    const { data: pr } = await client.rest.pulls.get(params(r, c));
    await assertCurrentRun(r, c);
    if (!pr.auto_merge) return true;
    await client.graphql(
      "mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { pullRequest { id } } }",
      { id: pr.node_id, request: { signal: c.signal } },
    );
    await assertCurrentRun(r, c);
    return (await client.rest.pulls.get(params(r, c))).data.auto_merge === null;
  };
  async function triage(r: ReviewRequest, classification: string, c: CallContext) {
    await check(
      r,
      config.checks.triage,
      "success",
      `Margot triage: ${classification}`,
      "Fresh classification for CI; no merge authority.",
      JSON.stringify({
        decision_source: "jev",
        head_sha: r.head,
        classification,
        mechanical: classification === "mechanical",
      }),
      c,
    );
  }
  const heldReason = (decision: { holdReasons: string[]; rating: { band: string } }) =>
    decision.holdReasons.includes("review-authority")
      ? "a change to Margot's own machinery"
      : decision.holdReasons.includes("calibration")
        ? "calibration mode"
        : `risk is ${decision.rating.band}`;
  const publish: Services["publish"] = async ({ expectedHead, review, report }, c) => {
    const r = review.request;
    if (!active || JSON.stringify(active) !== JSON.stringify(r) || expectedHead !== r.head)
      throw new Error("Publication must run inside its check lifecycle");
    const { decision } = review;
    if (!decision.mergeEligible && !(await disableAutoMerge(r, c)))
      throw new Error("Auto-merge disable was not confirmed");
    await triage(r, review.classification, c);
    const authorityHold = decision.holdReasons.includes("review-authority");
    await check(
      r,
      config.checks.authority,
      authorityHold ? "neutral" : "success",
      authorityHold
        ? "self-instrument: held for the operator's approval"
        : "self-instrument: clear",
      `Class: ${review.classification}. ${authorityHold ? "Review authority requires operator approval." : "No review-authority hold."}`,
      undefined,
      c,
    );
    // Complete all check writes before the approving review. The review-count rule
    // must hold even when the review check is informational, not required.
    const reviewConclusion = decision.holdReasons.includes("calibration")
      ? "action_required"
      : decision.mergeEligible
        ? "success"
        : "neutral";
    await check(
      r,
      config.checks.review,
      reviewConclusion,
      // Titles the estate's readers already know: Ollie turns a held title into its ask,
      // so the title names the reason the PR is actually held.
      decision.mergeEligible
        ? "Margot: approved"
        : decision.outcome === "APPROVED"
          ? `held for the operator: ${heldReason(decision)}`
          : `Margot: ${decision.outcome}`,
      `${decision.outcome}, ${decision.rating.band}: ${decision.rating.rationale}`,
      checkText(review),
      c,
    );
    await confirmReviewCheck(r, reviewConclusion, c);
    await guard(r, c);
    const { data } = await client.rest.pulls.createReview({
      ...params(r, c),
      commit_id: r.head,
      event: decision.mergeEligible ? "APPROVE" : "COMMENT",
      body: report,
    });
    if (decision.mergeEligible && Number.isSafeInteger(data.id)) approvalId = data.id;
    if (
      !Number.isSafeInteger(data.id) ||
      data.id <= 0 ||
      data.commit_id !== r.head ||
      data.user?.login !== config.actor ||
      data.user.type !== "Bot" ||
      data.state !== (decision.mergeEligible ? "APPROVED" : "COMMENTED")
    )
      throw new Error("Invalid native review receipt");
    await guard(r, c, decision.mergeEligible);
    return { recorded: false, head: r.head, id: String(data.id) };
  };
  async function run(
    r: ReviewRequest,
    evaluate: () => Promise<ReviewResult>,
  ): Promise<ReviewResult> {
    if (active) throw new Error("Publisher is single-use");
    active = requestSchema.parse(r);
    const context = () => ({ signal: AbortSignal.timeout(60000) });
    try {
      await check(
        r,
        r.phase === "triage" ? config.checks.triage : config.checks.review,
        null,
        "Margot: reviewing",
        "Clearance has not been established.",
        undefined,
        context(),
      );
      if (r.phase === "review") await withdraw(r, context());
      const result = await evaluate();
      if (result.kind === "error") throw new Error(`${result.stage}: ${result.diagnostic}`);
      if (result.kind === "classified") await triage(r, result.classification, context());
      else if (!result.publication || result.publication.recorded)
        throw new Error("Missing live publication receipt");
      return result;
    } catch (error) {
      const failures: string[] = [];
      // Each cleanup is independent; inability to write can never become a successful result.
      const cleanups: [string, () => Promise<unknown>][] = [
        [
          "disable auto-merge",
          () =>
            disableAutoMerge(r, context()).then((ok) => {
              if (!ok) throw new Error("disable unconfirmed");
            }),
        ],
        ["dismiss approvals", () => withdraw(r, context())],
        [
          "write error check",
          () =>
            check(
              r,
              r.phase === "triage" ? config.checks.triage : config.checks.review,
              "action_required",
              "Margot: not reviewed (error)",
              "Publication or evaluation failed; no clearance.",
              // Overwrite any verdict text already written for this head: with no
              // `outcome:` line Ollie reads "held without a verdict", never "approved".
              "no verdict: publication or evaluation failed after the check was opened",
              context(),
            ),
        ],
      ];
      for (const [label, cleanup] of cleanups) {
        try {
          await cleanup();
        } catch (cleanupError) {
          failures.push(
            `${label} cleanup unconfirmed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
      return {
        kind: "error",
        stage: "publication",
        mergeEligible: false,
        diagnostic: `${error instanceof Error ? error.message : "Publication failed"}${failures.length ? `; ${failures.join("; ")}` : ""}`,
      };
    }
  }
  return { run, publish, disableAutoMerge };
}
