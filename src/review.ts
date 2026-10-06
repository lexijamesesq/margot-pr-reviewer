import { diffLineCount } from "./diff.js";
import { errorMessage } from "./errors.js";
import {
  configHash,
  evidenceHash,
  nextLedger,
  prepareFindings,
  roundScope,
  selectLedger,
  standingCards,
} from "./ledger.js";
import {
  assignFindingIds,
  classify,
  decide,
  needsVoice,
  rate,
  requireRiskLine,
  reviewPath,
  selectCards,
  validateVoice,
  verifiedTriage,
} from "./policy.js";
import { classificationQuestions, riskQuestions, routeQuestions } from "./questions.js";
import { render, shownFindingGap } from "./render.js";
import {
  bundleSchema,
  cardSchema,
  classificationSchema,
  classNames,
  configSchema,
  disableAutoMergeSchema,
  factsSchema,
  publicationSchema,
  requestSchema,
  riskSchema,
  routeSchema,
  shaSchema,
  voiceSchema,
} from "./schemas.js";
import { type CardStage, cardStage, type Stage, stages } from "./stages.js";
import type {
  Bundle,
  Card,
  Facts,
  Review,
  ReviewCore,
  ReviewPhaseTitle,
  ReviewResult,
  Services,
  Voice,
} from "./types.js";

function ticket(body: string): { label: string; url: string } | null {
  const match = body.match(/https:\/\/[^\s/)]+\/[^\s)]*\/issue\/([^\s/?#)]+)/i);
  return match?.[0] && match[1] ? { label: match[1], url: match[0] } : null;
}

type CheckFact = Facts["checks"][number];
function currentCheck(runs: CheckFact[]): CheckFact | undefined {
  let current: CheckFact | undefined;
  for (const run of runs) {
    if (!current) current = run;
    else if ((run.startedAt ?? "") > (current.startedAt ?? "")) current = run;
    else if (
      (run.startedAt ?? "") === (current.startedAt ?? "") &&
      (run.id ?? 0) > (current.id ?? 0)
    )
      current = run;
  }
  return current;
}
export async function review(
  requestInput: unknown,
  configInput: unknown,
  services: Services,
): Promise<ReviewResult> {
  const startedAt = Date.now();
  let stage = stages.input as Stage | CardStage;
  let emergencyDisable: (() => Promise<boolean>) | undefined;
  try {
    const request = requestSchema.parse(requestInput);
    const config = configSchema.parse(configInput);
    const call = async <T>(
      name: Stage | CardStage,
      run: (context: { signal: AbortSignal }) => Promise<T>,
    ): Promise<T> => {
      stage = name;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run({ signal: controller.signal }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error(`${name} timed out`));
            }, config.timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const disableAutoMerge = async (name: Stage): Promise<boolean> =>
      disableAutoMergeSchema.parse(await call(name, (c) => services.disableAutoMerge(request, c)));
    const progress = async (title: ReviewPhaseTitle): Promise<void> => {
      const reportProgress = services.progress;
      if (reportProgress) {
        try {
          await call(stages.publicationProgress, (context) => reportProgress(title, context));
        } catch (error) {
          console.warn(
            `Margot: phase-title update failed (${errorMessage(error)}); continuing review`,
          );
        }
      }
    };
    const facts = factsSchema.parse(await call(stages.facts, (c) => services.facts(request, c)));
    if (facts.autoMergeArmed)
      emergencyDisable = () => disableAutoMerge(stages.disableAutoMergeAfterError);
    if (
      !facts.complete ||
      facts.files.length !== facts.fileCount ||
      new Set(facts.files.map((f) => f.path)).size !== facts.files.length
    )
      throw new Error("Incomplete facts");
    if (
      facts.repository !== request.repository ||
      facts.pr !== request.pr ||
      facts.base !== request.base ||
      facts.head !== request.head
    )
      throw new Error("Facts do not match requested revision");
    stage = stages.history;
    const historyUnavailable =
      !facts.history.complete || (facts.history.priorLedger && !facts.history.reviews);
    const ledgerWarnings: string[] = [];
    const prior = selectLedger(facts, config, (warning) => ledgerWarnings.push(warning));
    // Unreadable history holds rather than approves: without the earlier ledger Margot cannot
    // know whether findings from earlier rounds were resolved, so an approval would be a guess.
    // The reason names the way out, because the hold recurs on every run until the history is
    // fixed or the operator merges.
    const recovery =
      "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.";
    const historyReason = historyUnavailable
      ? "Review history unavailable"
      : ledgerWarnings.length
        ? `Review history corrupt: ${ledgerWarnings.join("; ")}`
        : null;
    if (historyReason) {
      if (
        shaSchema.parse(await call(stages.holdHead, (c) => services.head(request, c))) !==
        request.head
      )
        throw new Error("Head moved before holding review");
      if (
        config.publication !== "none" &&
        facts.autoMergeArmed &&
        !(await disableAutoMerge(stages.disableAutoMerge))
      )
        throw new Error("Auto-merge disable was not confirmed");
      return { kind: "held", request, reason: historyReason, recovery, mergeEligible: false };
    }
    // A same-head re-run reuses the saved result only when nothing it depended on has moved.
    // Otherwise the head is reviewed afresh in the same round; a changed body,
    // configuration or base is a reason to look again, never a reason to refuse.
    let cached = prior?.head === request.head ? prior.receipt : undefined;
    if (
      cached &&
      (cached.configHash !== configHash(config) ||
        cached.review.provenance.services !== services.provenance ||
        // A degraded answer is not replayed once the service may have recovered.
        cached.review.provenance.decision_source === "fallback" ||
        cached.review.decision.outcome === "ERROR" ||
        cached.evidenceHash !== evidenceHash(facts) ||
        cached.review.request.base !== request.base)
    )
      cached = undefined;
    stage = stages.triage;
    const oversized = diffLineCount(facts.diff) > config.mechanicalDiffLineCap;
    let classification: (typeof classNames)[number] = "functional";
    let classSource = "diff_too_large";
    let mechanicalProbability: number | null = null;
    if (request.phase === "triage") {
      // The triage is the one classification: it asks Jev.
      if (!oversized) {
        const answer = classificationSchema.parse(
          await call(stages.classification, (c) =>
            services.classify(facts, classificationQuestions, c),
          ),
        );
        classification = classify(answer, config);
        classSource = answer.source;
        if (answer.source === "jev") mechanicalProbability = answer.mechanical;
      }
    } else {
      // The review never asks again: it takes the class from the verified triage for this
      // head, and is functional without one.
      const verified = verifiedTriage(facts.triage, config.trustedTriageActors, request.head);
      if (verified) {
        classification = verified.classification;
        classSource = "jev";
        mechanicalProbability = verified.mechanicalProbability ?? null;
      } else classSource = "triage_unavailable";
      // An oversized diff is never lowered below functional.
      if (oversized && classification !== "functional") {
        classification = "functional";
        classSource = "diff_too_large";
      }
      // Nothing dispatched (no class and no triage) means no override: the verified triage's
      // class stands. A dispatched class only ever makes the review stricter.
      const dispatched = request.classification
        ? (classNames.find((name) => name === request.classification) ?? "functional")
        : request.triage === "mechanical"
          ? "mechanical"
          : request.triage
            ? "functional"
            : undefined;
      if (dispatched && classNames.indexOf(dispatched) < classNames.indexOf(classification)) {
        classification = dispatched;
        classSource = "dispatch";
      }
    }
    if (cached && classification !== cached.review.classification) cached = undefined;
    if (request.phase === "triage")
      return {
        kind: "classified",
        request,
        classification,
        decision_source: classSource,
        mechanical_probability: mechanicalProbability,
      };
    stage = stages.checks;
    for (const name of config.requiredChecks) {
      // One name can carry several runs on one head: a workflow's concurrency cancels a
      // superseded run and the cancelled one stays in the list beside the current one.
      // The current run decides (most recent start, then id), as the required-check floor
      // gate does; with no recency recorded, the first listed wins.
      const check = currentCheck(facts.checks.filter((c) => c.name === name));
      if (
        !check ||
        check.head !== request.head ||
        !(
          check.conclusion === "success" ||
          (check.conclusion === "skipped" && config.allowedSkippedChecks.includes(name))
        ) ||
        !config.trustedCheckActors.includes(check.actor)
      )
        throw new Error(`Required check not trusted and green: ${name}`);
    }
    let comparison: unknown;
    const compare = services.compare;
    if (prior && prior.head !== request.head && !cached && compare) {
      try {
        comparison = await call(stages.compare, (c) => compare(request, prior.head, c));
      } catch (error) {
        // Complete full-PR evidence above is the recovery path.
        console.warn(
          `Margot: compare since the prior head failed (${errorMessage(error)}); reviewing the full PR`,
        );
        comparison = undefined;
      }
    }
    const scope = roundScope(facts, prior, comparison, cached !== undefined);
    let result: Review;
    if (cached && prior) {
      result = {
        ...cached.review,
        request,
        provenance: { ...cached.review.provenance, classification: classSource },
        ledger: prior,
        convergence: cached.counts,
      };
    } else {
      const cards: Card[] = [];
      let rating = rate(null, false, config);
      let routeAnswer: ReviewCore["routeAnswer"] = null;
      let riskAnswer: ReviewCore["riskAnswer"] = null;
      let voice: Voice | null = null;
      let bundle: Bundle | undefined;
      const loadBundle = async (): Promise<Bundle> => {
        if (!bundle) {
          const loaded = bundleSchema.parse(
            await call(stages.bundle, (c) => services.bundle(config.cardBundle.commit, c)),
          );
          if (loaded.commit !== config.cardBundle.commit)
            throw new Error("Card bundle pin mismatch");
          bundle = loaded;
        }
        return bundle;
      };
      const recalled = standingCards(scope);
      const ledgerOpen = recalled.length > 0;
      if (reviewPath(classification, null, config, ledgerOpen).routing) {
        const { documentation_substantive: _substance, ...functionalRouteQuestions } =
          routeQuestions;
        const questions =
          classification === "documentation" ? routeQuestions : functionalRouteQuestions;
        const scopedFacts = {
          ...facts,
          diff: scope.diff || "No delta on this PR",
          files: scope.files,
          fileCount: scope.files.length,
        };
        // Routing reads the whole PR, as risk does; the cards read this round's scope.
        routeAnswer = routeSchema.parse(
          await call(stages.route, (c) => services.route(facts, classification, questions, c)),
        );
        const path = reviewPath(classification, routeAnswer, config, ledgerOpen);
        if (path.council) {
          await progress("Margot: council is reviewing the changes");
          const selected = selectCards(routeAnswer, classification, config, recalled);
          if (selected.length > 0) {
            const resolved = await loadBundle();
            const completed = await Promise.allSettled(
              selected.map(async (name) => {
                const card = cardSchema.parse(
                  await call(cardStage(name), (c) =>
                    services.card(
                      {
                        facts: {
                          ...scopedFacts,
                          history: { complete: true, priorLedger: prior !== null },
                        },
                        name,
                        classification,
                        agent: resolved.reviewerAgent,
                        round: {
                          ...scope,
                          entries: scope.entries.filter(
                            (e) => e.card === name && ["standing", "dismissed"].includes(e.status),
                          ),
                        },
                      },
                      c,
                    ),
                  ),
                );
                if (card.name !== name) throw new Error("Wrong card returned");
                return card;
              }),
            );
            for (const [index, completion] of completed.entries()) {
              if (completion.status === "rejected") {
                stage = cardStage(String(selected[index]));
                throw completion.reason;
              }
              cards.push(completion.value);
            }
            stage = stages.cards;
            assignFindingIds(cards);
            prepareFindings(cards, scope);
            const ids = cards.flatMap((c) => c.findings.flatMap((f) => (f.id ? [f.id] : [])));
            if (new Set(ids).size !== ids.length) throw new Error("Duplicate finding IDs");
          }
          if (path.risk) {
            riskAnswer = riskSchema.parse(
              await call(stages.risk, (c) => services.risk(facts, cards, riskQuestions, c)),
            );
            rating = rate(riskAnswer, cards.length === 0, config);
          }
          if (needsVoice(cards, rating, routeAnswer.confidence, config)) {
            const resolved = await loadBundle();
            voice = voiceSchema.parse(
              await call(stages.voice, (c) =>
                services.voice(
                  {
                    facts: { ...facts, history: { complete: true, priorLedger: prior !== null } },
                    classification,
                    cards,
                    rating,
                    agent: resolved.voiceAgent,
                    round: scope,
                  },
                  c,
                ),
              ),
            );
            validateVoice(cards, voice);
            stage = stages.templateGate;
            requireRiskLine(voice);
          }
        }
      }
      const core: ReviewCore = {
        request,
        classification,
        routeAnswer,
        riskAnswer,
        cards,
        voice,
        decision: decide(classification, facts, config, rating, voice),
        provenance: {
          cardBundle: config.cardBundle.commit,
          classification: classSource,
          mechanicalProbability,
          summonedByLedger: recalled.filter(
            (name) => !routeAnswer || (routeAnswer.cards[name] ?? 0) < config.routeThreshold,
          ),
          // Documentation's LOW band comes from the verified class, not from routing: a
          // routing outage summons review, and does not make accuracy the operator's risk.
          decision_source:
            classification !== "documentation" &&
            ((routeAnswer && routeAnswer.source !== "jev") ||
              (riskAnswer && riskAnswer.source !== "jev"))
              ? "fallback"
              : "jev",
          services: services.provenance,
        },
      };
      if (core.provenance.decision_source !== "jev") {
        core.decision.mergeEligible = false;
        if (routeAnswer && routeAnswer.source !== "jev")
          core.decision.holdReasons.push("fallback-routing");
        if (riskAnswer && riskAnswer.source !== "jev")
          core.decision.holdReasons.push("fallback-risk");
      }
      // The comment's card rows each need a plain sentence; one without is not posted.
      const before = stage;
      stage = stages.templateGate;
      const gap = shownFindingGap(core);
      if (gap) throw new Error(gap);
      stage = before;
      result = { ...core, ...nextLedger(scope, cards, voice, core, config, facts) };
    }
    const metadata = services.reviewMetadata?.() ?? {};
    result = {
      ...result,
      presentation: {
        author: facts.author,
        costUsd: typeof metadata.costUsd === "number" ? metadata.costUsd : null,
        durationMs:
          typeof metadata.durationMs === "number" ? metadata.durationMs : Date.now() - startedAt,
        files: facts.fileCount,
        runUrl: metadata.runUrl ?? null,
        ticket: ticket(facts.body),
        ...(config.mergeActor ? { mergeActor: config.mergeActor } : {}),
      },
    };
    stage = stages.render;
    if (result.voice) validateVoice(result.cards, result.voice);
    const report = render(result);
    await progress("Margot: posting the verdict");
    let publication = null;
    if (
      shaSchema.parse(await call(stages.publicationHead, (c) => services.head(request, c))) !==
      request.head
    )
      throw new Error("Head moved before publication");
    if (config.publication !== "none") {
      if (
        config.publication !== "github" &&
        !result.decision.mergeEligible &&
        facts.autoMergeArmed &&
        !(await disableAutoMerge(stages.disableAutoMerge))
      )
        throw new Error("Auto-merge disable was not confirmed");
      publication = publicationSchema.parse(
        await call(stages.publication, (c) =>
          services.publish({ expectedHead: request.head, review: result, report }, c),
        ),
      );
      if (publication.head !== request.head) throw new Error("Publication receipt has wrong head");
    }
    return { kind: "reviewed", ...result, report, publication };
  } catch (error) {
    const failedStage = stage;
    let diagnostic = errorMessage(error);
    if (emergencyDisable) {
      try {
        if (!(await emergencyDisable())) diagnostic += "; auto-merge disable not confirmed";
      } catch (disableError) {
        console.warn(`Margot: auto-merge disable failed (${errorMessage(disableError)})`);
        diagnostic += "; auto-merge disable failed";
      }
    }
    return { kind: "error", stage: failedStage, diagnostic, mergeEligible: false };
  }
}
