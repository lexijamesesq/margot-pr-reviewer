import type { Octokit } from "octokit";
import type { z } from "zod";
import { checkText } from "../render.js";
import { publisherSchema, requestSchema } from "../schemas.js";
import type { CallContext, ReviewRequest, ReviewResult, Services } from "../types.js";

type RefusalReason = "draft" | "fork" | "closed" | "stale";

class PublicationRefusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(`Margot: not reviewed: ${reason}`);
  }
}

/** Adopt the caller check by App/name/head; its run URL fences superseded writers. */
export function githubPublisher(client: Octokit, input: z.infer<typeof publisherSchema>) {
  const config = publisherSchema.parse(input);
  const ids = new Map<string, number>();
  let active: ReviewRequest | undefined;
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
    if (!merged && data.state !== "open") throw new PublicationRefusal("closed");
    if (data.draft) throw new PublicationRefusal("draft");
    if (data.head.repo?.full_name !== r.repository) throw new PublicationRefusal("fork");
    if (data.head.sha !== r.head || (!merged && data.base.sha !== r.base))
      throw new PublicationRefusal("stale");
    return data;
  }
  async function writeCheck(
    r: ReviewRequest,
    name: string,
    conclusion: "success" | "neutral" | "action_required" | null,
    title: string,
    summary: string,
    text: string | undefined,
    c: CallContext,
  ) {
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
    await writeCheck(r, name, conclusion, title, summary, text, c);
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
  const progress: NonNullable<Services["progress"]> = async (title, c) => {
    if (active?.phase !== "review")
      throw new Error("Review progress requires an active review lifecycle");
    await check(
      active,
      config.checks.review,
      null,
      title,
      "Clearance has not been established.",
      undefined,
      c,
    );
  };
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
      authorityHold
        ? "This PR changes Margot's own config, the estate ownership map, or a gate workflow — a surface that could disarm the gate. Margot does not approve it herself; it merges on the operator's approval.\n\nMatched:\n" +
            (decision.authorityPaths ?? []).map((path) => `- \`${path}\``).join("\n")
        : `No functional change to a protected path (class: ${review.classification}).`,
      undefined,
      c,
    );
    // Complete all check writes before the approving review. The review-count rule
    // must hold even when the review check is informational, not required.
    // Python's gate: Margot's own ERROR ruling is `action_required`, so an unreviewed PR
    // never satisfies the required check; held and author-action verdicts stay `neutral`.
    const reviewConclusion =
      decision.holdReasons.includes("calibration") || decision.outcome === "ERROR"
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
          : decision.outcome === "ERROR"
            ? "not reviewed (error)"
            : `Margot: ${decision.outcome}`,
      `${decision.outcome}, ${decision.rating.band}: ${decision.rating.rationale}`,
      checkText(review),
      c,
    );
    await confirmReviewCheck(r, reviewConclusion, c);
    // Margot never dismisses her own earlier approvals: a new head gets a new review, and
    // the estate's ruleset handles stale approvals, as it did for the Python reviewer.
    await guard(r, c);
    const { data } = await client.rest.pulls.createReview({
      ...params(r, c),
      commit_id: r.head,
      event: decision.mergeEligible ? "APPROVE" : "COMMENT",
      body: report,
    });
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
        r.phase === "review" ? "Margot: preflight — mechanical checks" : "Margot: reviewing",
        "Clearance has not been established.",
        undefined,
        context(),
      );
      const result = await evaluate();
      if (result.kind === "error") {
        const refusal = result.diagnostic.match(
          /Margot: not reviewed: (draft|fork|closed|stale)/,
        )?.[1] as RefusalReason | undefined;
        if (refusal) throw new PublicationRefusal(refusal);
        throw new Error(`${result.stage}: ${result.diagnostic}`);
      }
      if (result.kind === "classified") await triage(r, result.classification, context());
      else if (!result.publication || result.publication.recorded)
        throw new Error("Missing live publication receipt");
      return result;
    } catch (error) {
      if (error instanceof PublicationRefusal) {
        const refusalFailures: string[] = [];
        try {
          if (!(await disableAutoMerge(r, context())))
            refusalFailures.push("disable auto-merge cleanup unconfirmed: disable unconfirmed");
        } catch (disableError) {
          refusalFailures.push(
            `disable auto-merge cleanup unconfirmed: ${disableError instanceof Error ? disableError.message : String(disableError)}`,
          );
        }
        try {
          await writeCheck(
            r,
            r.phase === "triage" ? config.checks.triage : config.checks.review,
            "neutral",
            error.message,
            "Clearance has not been established.",
            undefined,
            context(),
          );
        } catch (refusalError) {
          refusalFailures.push(
            `refusal check unconfirmed: ${refusalError instanceof Error ? refusalError.message : String(refusalError)}`,
          );
        }
        return {
          kind: "error",
          stage: "publication",
          mergeEligible: false,
          diagnostic: `${error.message}${refusalFailures.length ? `; ${refusalFailures.join("; ")}` : ""}`,
        };
      }
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
  return { run, publish, disableAutoMerge, progress };
}
