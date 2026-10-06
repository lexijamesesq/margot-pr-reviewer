import type { Octokit } from "octokit";
import type { z } from "zod";
import { errorMessage } from "../errors.js";
import { holdReason } from "../policy.js";
import { checkSummary, checkText } from "../render.js";
import { publisherSchema, requestSchema } from "../schemas.js";
import { type Stage, stages } from "../stages.js";
import type { CallContext, ReviewRequest, ReviewResult, Services } from "../types.js";

// What the pull request is told when an error comes once the council has begun. An error
// at any other stage ends as a check only; "publication-head" is a stale-head stop, which
// stays check-only like every stale refusal. The sentence is fixed per stage: the check
// carries the diagnostic, which the conversation never repeats.
const councilReason = "A council reviewer could not complete its review";
const notReviewedReasons: Partial<Record<Stage, string>> = {
  [stages.cards]: councilReason,
  [stages.risk]: "The risk could not be scored",
  [stages.voice]: "The verdict could not be written",
  [stages.render]: "The review comment could not be rendered",
  [stages.publication]: "The review could not be published",
};
export function notReviewedReason(stage: string): string | undefined {
  return stage.startsWith("card:") ? councilReason : notReviewedReasons[stage as Stage];
}

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
  // Set once the native review is on the pull request, so a later failure never says "not reviewed".
  let reviewPosted = false;
  // The refusal the guard last raised, so a review that failed on it is refused, not errored.
  let refused: PublicationRefusal | undefined;
  const refuse = (reason: RefusalReason) => (refused = new PublicationRefusal(reason));
  const checkName = (r?: Pick<ReviewRequest, "phase">) =>
    r?.phase === "triage" ? config.checks.triage : config.checks.review;
  const params = (r: ReviewRequest, c: CallContext) => {
    requestSchema.parse(r);
    const [owner = "", repo = ""] = r.repository.split("/");
    return { owner, repo, pull_number: r.pr, request: { signal: c.signal } };
  };
  async function assertCurrentRun(r: ReviewRequest, c: CallContext) {
    const primary = checkName(active);
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
    refused = undefined;
    const { data } = await client.rest.pulls.get(params(r, c));
    await assertCurrentRun(r, c);
    const merged = allowMerged && data.merged;
    if (!merged && data.state !== "open") throw refuse("closed");
    if (data.draft) throw refuse("draft");
    if (data.head.repo?.full_name !== r.repository) throw refuse("fork");
    if (data.head.sha !== r.head || (!merged && data.base.sha !== r.base)) throw refuse("stale");
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
      output: { title, summary, ...(text ? { text: capCheckText(text) } : {}) },
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
    if (!id) throw new Error("Review check was not completed after publication");
    const { data } = await client.rest.checks.get({ ...params(r, c), check_run_id: id });
    if (
      data.status !== "completed" ||
      data.conclusion !== conclusion ||
      data.head_sha !== r.head ||
      data.app?.id !== config.appId
    )
      throw new Error("Review check was not confirmed after publication");
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
  async function triage(
    r: ReviewRequest,
    classification: string,
    c: CallContext,
    source = "jev",
    mechanicalProbability: number | null = null,
  ) {
    await check(
      r,
      config.checks.triage,
      "success",
      `Margot triage: ${classification}`,
      "Fresh classification for CI; no merge authority.",
      JSON.stringify({
        decision_source: source,
        head_sha: r.head,
        classification,
        mechanical: classification === "mechanical",
        ...(mechanicalProbability === null
          ? {}
          : { mechanical_probability: mechanicalProbability }),
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
  const publish: Services["publish"] = async ({ expectedHead, review, report }, c) => {
    const r = review.request;
    if (!active || JSON.stringify(active) !== JSON.stringify(r) || expectedHead !== r.head)
      throw new Error("Publication must run inside its check lifecycle");
    const { decision } = review;
    // The review run never writes `review / triage`; that check is the triage run's alone.
    // Rewriting it here replaced Jev's answer with the review's merged class, which
    // readers of that check reject unless it came from Jev, so a mechanical PR read as functional.
    const authorityHold = decision.holdReasons.includes("review-authority");
    await check(
      r,
      config.checks.authority,
      authorityHold ? "neutral" : "success",
      authorityHold
        ? "self-instrument: held for the operator's approval"
        : "self-instrument: clear",
      authorityHold
        ? "This PR changes files Margot's own review depends on (the configured protected paths). Margot does not approve such a change by itself; it waits for a maintainer's approval.\n\nMatched:\n" +
            (decision.authorityPaths ?? []).map((path) => `- \`${path}\``).join("\n")
        : `No functional change to a protected path (class: ${review.classification}).`,
      undefined,
      c,
    );
    // Margot never dismisses her own earlier approvals: a new head gets a new review, and
    // branch protection handles stale approvals.
    await guard(r, c);
    const { data } = await client.rest.pulls.createReview({
      ...params(r, c),
      commit_id: r.head,
      event: decision.mergeEligible ? "APPROVE" : "COMMENT",
      body: report,
    });
    reviewPosted = true;
    if (
      !Number.isSafeInteger(data.id) ||
      data.id <= 0 ||
      data.commit_id !== r.head ||
      data.user?.login !== config.actor ||
      data.user.type !== "Bot" ||
      data.state !== (decision.mergeEligible ? "APPROVED" : "COMMENTED")
    )
      throw new Error("Invalid native review receipt");
    if (!decision.mergeEligible && !(await disableAutoMerge(r, c)))
      throw new Error("Auto-merge disable was not confirmed");
    // Review first, then disarm held PRs, then conclude the required check.
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
      // A held title is what merge automation surfaces to the operator, so it names the
      // reason the PR is actually held.
      decision.mergeEligible
        ? "Margot: approved"
        : decision.outcome === "APPROVED"
          ? `held for the operator: ${holdReason(decision).sentence}`
          : decision.outcome === "ERROR"
            ? "not reviewed (error)"
            : `Margot: ${decision.outcome}`,
      checkSummary(review),
      checkText(review),
      c,
    );
    await confirmReviewCheck(r, reviewConclusion, c);
    await guard(r, c, decision.mergeEligible);
    return { recorded: false, head: r.head, id: String(data.id) };
  };
  async function run(
    r: ReviewRequest,
    evaluate: () => Promise<ReviewResult>,
  ): Promise<ReviewResult> {
    if (active) throw new Error("Publisher is single-use");
    active = requestSchema.parse(r);
    let notReviewed: string | undefined;
    const context = () => ({ signal: AbortSignal.timeout(60000) });
    try {
      await check(
        r,
        checkName(r),
        null,
        r.phase === "review"
          ? "Margot: preflight complete — setting up the review runner"
          : "Margot: reviewing",
        "Clearance has not been established.",
        undefined,
        context(),
      );
      const result = await evaluate();
      if (result.kind === "error") {
        if (refused && result.stage === stages.publication) throw refused;
        notReviewed = notReviewedReason(result.stage);
        throw new Error(`${result.stage}: ${result.diagnostic}`);
      }
      if (result.kind === "held") {
        await guard(r, context());
        if (!(await disableAutoMerge(r, context())))
          throw new Error("Auto-merge disable was not confirmed");
        await check(
          r,
          checkName(r),
          "action_required",
          `held for the operator: ${result.reason}`.slice(0, 255),
          capCheckText(result.recovery ? `${result.reason}\n\n${result.recovery}` : result.reason),
          result.recovery ? `${result.reason}. ${result.recovery}` : result.reason,
          context(),
        );
        return result;
      }
      if (result.kind === "classified")
        await triage(
          r,
          result.classification,
          context(),
          result.decision_source,
          result.mechanical_probability ?? null,
        );
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
            `disable auto-merge cleanup unconfirmed: ${errorMessage(disableError)}`,
          );
        }
        try {
          await writeCheck(
            r,
            checkName(r),
            "neutral",
            error.message,
            "Clearance has not been established.",
            undefined,
            context(),
          );
        } catch (refusalError) {
          refusalFailures.push(`refusal check unconfirmed: ${errorMessage(refusalError)}`);
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
              checkName(r),
              "action_required",
              "Margot: not reviewed (error)",
              "Publication or evaluation failed; no clearance. The review run's log has the diagnostic.",
              // Overwrite any verdict text already written for this head: with no
              // `outcome:` line a reader sees "held without a verdict", never "approved".
              "no verdict: publication or evaluation failed after the check was opened",
              context(),
            ),
        ],
      ];
      for (const [label, cleanup] of cleanups) {
        try {
          await cleanup();
        } catch (cleanupError) {
          failures.push(`${label} cleanup unconfirmed: ${errorMessage(cleanupError)}`);
        }
      }
      // The check is closed first; the author then gets the reason in the conversation too.
      // Nothing is said when the review is already on the pull request, or when the head
      // has moved, the pull request has closed or this run has been superseded.
      if (notReviewed !== undefined && !reviewPosted) {
        // A deliberate refusal (closed, draft, fork, stale) skips the comment quietly; any
        // other failure to confirm the pull request is recorded, so a skip is never silent.
        const stillCurrent = await guard(r, context()).then(
          () => true,
          (guardError: unknown) => {
            if (!(guardError instanceof PublicationRefusal))
              failures.push(`not-reviewed comment skipped: ${errorMessage(guardError)}`);
            return false;
          },
        );
        if (stillCurrent)
          try {
            await client.rest.pulls.createReview({
              ...params(r, context()),
              commit_id: r.head,
              event: "COMMENT",
              body: `Not reviewed: ${notReviewed}. The review run has the details. Held for the operator.`,
            });
          } catch (commentError) {
            failures.push(`not-reviewed comment unconfirmed: ${errorMessage(commentError)}`);
          }
      }
      return {
        kind: "error",
        stage: "publication",
        mergeEligible: false,
        diagnostic: `${errorMessage(error)}${failures.length ? `; ${failures.join("; ")}` : ""}`,
      };
    }
  }
  return { run, publish, disableAutoMerge, progress };
}

export function capCheckText(text: string): string {
  const note = "\n[Margot: check text truncated]";
  const characters = Array.from(text);
  return characters.length <= 60000
    ? text
    : characters.slice(0, 60000 - note.length).join("") + note;
}
