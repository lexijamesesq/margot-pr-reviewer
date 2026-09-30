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
import type { Bundle, Card, Review, ReviewCore, ReviewResult, Services, Voice } from "./types.js";

/** Validate all external data, including data returned by a typed adapter. */
export async function review(
  requestInput: unknown,
  configInput: unknown,
  services: Services,
): Promise<ReviewResult> {
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
    const classification =
      cached?.review.classification ??
      classify(
        classificationSchema.parse(
          await call("classification", (c) => services.classify(facts, classificationQuestions, c)),
        ),
        facts,
        config,
      );
    if (request.phase === "triage") return { kind: "classified", request, classification };
    stage = "checks";
    for (const name of config.requiredChecks) {
      const checks = facts.checks.filter((check) => check.name === name);
      if (
        checks.length !== 1 ||
        !checks.every(
          (check) =>
            check.head === request.head &&
            (check.conclusion === "success" ||
              (check.conclusion === "skipped" && config.allowedSkippedChecks.includes(name))) &&
            config.trustedCheckActors.includes(check.actor),
        )
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
        const route = routeSchema.parse(
          await call("route", (c) => services.route(scopedFacts, classification, questions, c)),
        );
        const path = reviewPath(classification, route, config);
        if (path.council || recalled.length > 0) {
          const selected = [
            ...new Set([
              ...(path.council ? selectCards(route, classification, config) : []),
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
          if (path.risk)
            rating = rate(
              riskSchema.parse(
                await call("risk", (c) => services.risk(facts, cards, riskQuestions, c)),
              ),
              cards.length === 0,
              config,
            );
          if (needsVoice(cards, rating, route.confidence, config)) {
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
