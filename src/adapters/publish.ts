import type { Octokit } from "octokit";
import type { z } from "zod";
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
  async function guard(r: ReviewRequest, c: CallContext) {
    const { data } = await client.rest.pulls.get(params(r, c));
    if (
      data.state !== "open" ||
      data.draft ||
      data.head.repo?.full_name !== r.repository ||
      data.head.sha !== r.head ||
      data.base.sha !== r.base
    )
      throw new Error("Publication refused: admission or revision changed");
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
      id = checks
        .filter((v) => v.name === name && v.head_sha === r.head && v.app?.id === config.appId)
        .sort((a, b) => b.id - a.id)[0]?.id;
    }
    const { data } = id
      ? await client.rest.checks.update({ ...payload, check_run_id: id })
      : await client.rest.checks.create(payload);
    // Save a valid ID even if other response fields are wrong, for error cleanup.
    if (Number.isSafeInteger(data.id)) ids.set(name, data.id);
    if (
      !Number.isSafeInteger(data.id) ||
      data.id <= 0 ||
      data.head_sha !== r.head ||
      data.name !== name ||
      data.app?.id !== config.appId ||
      data.status !== payload.status ||
      (conclusion && data.conclusion !== conclusion)
    )
      throw new Error("Invalid check write receipt");
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
      await guard(r, c);
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
    const pr = await guard(r, c);
    if (!pr.auto_merge) return true;
    await client.graphql(
      "mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { pullRequest { id } } }",
      { id: pr.node_id, request: { signal: c.signal } },
    );
    return (await guard(r, c)).auto_merge === null;
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
      decision.mergeEligible ? "Margot: approved" : `Margot: ${decision.outcome} — held`,
      `${decision.outcome}, ${decision.rating.band}: ${decision.rating.rationale}`,
      undefined,
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
    await guard(r, c);
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
      for (const cleanup of [
        () =>
          disableAutoMerge(r, context()).then((ok) => {
            if (!ok) throw new Error("disable unconfirmed");
          }),
        () => withdraw(r, context()),
        () =>
          check(
            r,
            r.phase === "triage" ? config.checks.triage : config.checks.review,
            "action_required",
            "Margot: not reviewed (error)",
            "Publication or evaluation failed; no clearance.",
            undefined,
            context(),
          ),
      ]) {
        try {
          await cleanup();
        } catch {
          failures.push("cleanup unconfirmed");
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
