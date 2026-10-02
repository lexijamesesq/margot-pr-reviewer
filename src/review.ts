import { changedLineCount } from "./diff.js";
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
  classify,
  decide,
  needsVoice,
  rate,
  reviewPath,
  selectCards,
  validateVoice,
} from "./policy.js";
import { classificationQuestions, riskQuestions, routeQuestions } from "./questions.js";
import { render } from "./render.js";
import {
  bundleSchema,
  cardSchema,
  classificationSchema,
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
import type {
  Bundle,
  Card,
  Facts,
  Review,
  ReviewCore,
  ReviewResult,
  Services,
  Voice,
} from "./types.js";

function ticket(body: string): { label: string; url: string } | null {
  const match = body.match(/https:\/\/linear\.app\/[^\s)]+\/issue\/([^\s/?#)]+)/i);
  return match?.[0] && match[1] ? { label: match[1], url: match[0] } : null;
}

/** Validate all external data, including data returned by a typed adapter. */
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
  let stage = "input";
  let emergencyDisable: (() => Promise<boolean>) | undefined;
  try {
    const request = requestSchema.parse(requestInput);
    const config = configSchema.parse(configInput);
    const call = async <T>(
      name: string,
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
    const disableAutoMerge = async (name: string): Promise<boolean> =>
      disableAutoMergeSchema.parse(await call(name, (c) => services.disableAutoMerge(request, c)));
    const facts = factsSchema.parse(await call("facts", (c) => services.facts(request, c)));
    if (facts.autoMergeArmed)
      emergencyDisable = () => disableAutoMerge("disable-auto-merge-after-error");
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
    stage = "history";
    const prior = selectLedger(facts, config);
    const cached = prior?.head === request.head ? prior.receipt : undefined;
    if (
      prior?.head === request.head &&
      (!cached ||
        cached.configHash !== configHash(config) ||
        cached.review.provenance.services !== services.provenance ||
        cached.evidenceHash !== evidenceHash(facts) ||
        cached.review.request.base !== request.base)
    )
      throw new Error("Same-head history has no compatible saved result");
    stage = "triage";
    if (
      facts.triage &&
      (!config.trustedTriageActors.includes(facts.triage.actor) ||
        facts.triage.head !== request.head ||
        facts.triage.base !== request.base)
    )
      throw new Error("Untrusted triage receipt");
    // A change larger than this cap is not a candidate for the mechanical
    // short-circuit. Jev never sees it and the PR takes the full review path: a
    // huge change is unlikely to be purely mechanical, and review is the safe miss.
    const oversized = changedLineCount(facts.diff) > config.mechanicalDiffLineCap;
    const classification =
      cached?.review.classification ??
      (oversized
        ? "functional"
        : classify(
            classificationSchema.parse(
              await call("classification", (c) =>
                services.classify(facts, classificationQuestions, c),
              ),
            ),
            facts,
            config,
          ));
    if (request.phase === "triage") return { kind: "classified", request, classification };
    stage = "checks";
    for (const name of config.requiredChecks) {
      // One name can carry several runs on one head: a workflow's concurrency cancels a
      // superseded run and the cancelled one stays in the list beside the current one.
      // The current run decides (most recent start, then id), as the estate's floor
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
    if (prior && !cached && compare) {
      try {
        comparison = await call("compare", (c) => compare(request, prior.head, c));
      } catch {
        comparison = undefined;
      } // Complete full-PR evidence above is the recovery path.
    }
    const scope = roundScope(facts, prior, comparison);
    let result: Review;
    if (cached && prior) {
      result = { ...cached.review, ledger: prior, convergence: cached.counts };
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
            await call("bundle", (c) => services.bundle(config.cardBundle.commit, c)),
          );
          if (loaded.commit !== config.cardBundle.commit)
            throw new Error("Card bundle pin mismatch");
          bundle = loaded;
        }
        return bundle;
      };
      const recalled = standingCards(scope);
      if (reviewPath(classification, null, config).routing || recalled.length > 0) {
        const { documentationSubstantive: _documentationSubstantive, ...functionalRouteQuestions } =
          routeQuestions;
        const questions =
          classification === "documentation" ? routeQuestions : functionalRouteQuestions;
        const scopedFacts = {
          ...facts,
          diff: scope.diff || "No delta on this PR",
          files: scope.files,
          fileCount: scope.files.length,
        };
        routeAnswer = routeSchema.parse(
          await call("route", (c) => services.route(scopedFacts, classification, questions, c)),
        );
        const path = reviewPath(classification, routeAnswer, config);
        if (path.council || recalled.length > 0) {
          const selected = [
            ...new Set([
              ...(path.council ? selectCards(routeAnswer, classification, config) : []),
              ...recalled,
            ]),
          ];
          if (selected.length > 0) {
            const resolved = await loadBundle();
            const completed = await Promise.allSettled(
              selected.map(async (name) => {
                const card = cardSchema.parse(
                  await call(`card:${name}`, (c) =>
                    services.card(
                      {
                        facts: {
                          ...scopedFacts,
                          history: { complete: true, priorLedger: prior !== null },
                        },
                        name,
                        classification,
                        cardPath: resolved.cardPaths[name],
                        agent: resolved.reviewerAgent,
                        round: {
                          ...scope,
                          entries: scope.entries.filter(
                            (e) =>
                              e.card === name &&
                              ["standing", "dismissed", "advisory"].includes(e.status),
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
                stage = `card:${selected[index]}`;
                throw completion.reason;
              }
              cards.push(completion.value);
            }
            stage = "cards";
            prepareFindings(cards, scope);
            const ids = cards.flatMap((c) => c.findings.map((f) => f.id));
            if (new Set(ids).size !== ids.length) throw new Error("Duplicate finding IDs");
          }
          if (path.risk) {
            riskAnswer = riskSchema.parse(
              await call("risk", (c) => services.risk(facts, cards, riskQuestions, c)),
            );
            rating = rate(riskAnswer, cards.length === 0, config);
          }
          if (needsVoice(cards, rating, routeAnswer.confidence, config)) {
            const resolved = await loadBundle();
            voice = voiceSchema.parse(
              await call("voice", (c) =>
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
          classification: "fresh-jev",
          services: services.provenance,
        },
      };
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
      },
    };
    stage = "render";
    const report = render(result);
    let publication = null;
    if (
      shaSchema.parse(await call("publication-head", (c) => services.head(request, c))) !==
      request.head
    )
      throw new Error("Head moved before publication");
    if (config.publication !== "none") {
      if (
        !result.decision.mergeEligible &&
        facts.autoMergeArmed &&
        !(await disableAutoMerge("disable-auto-merge"))
      )
        throw new Error("Auto-merge disable was not confirmed");
      publication = publicationSchema.parse(
        await call("publication", (c) =>
          services.publish({ expectedHead: request.head, review: result, report }, c),
        ),
      );
      if (publication.head !== request.head) throw new Error("Publication receipt has wrong head");
    }
    return { kind: "reviewed", ...result, report, publication };
  } catch (error) {
    const failedStage = stage;
    let diagnostic = error instanceof Error ? error.message : "Service failed";
    if (emergencyDisable) {
      try {
        if (!(await emergencyDisable())) diagnostic += "; auto-merge disable not confirmed";
      } catch {
        diagnostic += "; auto-merge disable failed";
      }
    }
    return { kind: "error", stage: failedStage, diagnostic, mergeEligible: false };
  }
}
