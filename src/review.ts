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
import type { Bundle, Card, Review, ReviewResult, Services, Voice } from "./types.js";

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
    if (!facts.history.complete) throw new Error("History unavailable");
    if (facts.history.priorLedger) throw new Error("Ledger reviews require slice 3");
    stage = "triage";
    if (
      facts.triage &&
      (!config.trustedTriageActors.includes(facts.triage.actor) ||
        facts.triage.head !== request.head ||
        facts.triage.base !== request.base)
    )
      throw new Error("Untrusted triage receipt");
    const classification = classify(
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
            check.conclusion === "success" &&
            config.trustedCheckActors.includes(check.actor),
        )
      )
        throw new Error(`Required check not trusted and green: ${name}`);
    }
    const cards: Card[] = [];
    let rating = rate(null, false, config);
    let voice: Voice | null = null;
    let bundle: Bundle | undefined;
    const loadBundle = async (): Promise<Bundle> => {
      if (!bundle) {
        const loaded = bundleSchema.parse(
          await call("bundle", (c) => services.bundle(config.cardBundle.commit, c)),
        );
        if (loaded.commit !== config.cardBundle.commit) throw new Error("Card bundle pin mismatch");
        bundle = loaded;
      }
      return bundle;
    };
    if (reviewPath(classification, null, config).routing) {
      const { documentationSubstantive: _documentationSubstantive, ...functionalRouteQuestions } =
        routeQuestions;
      const questions =
        classification === "documentation" ? routeQuestions : functionalRouteQuestions;
      const route = routeSchema.parse(
        await call("route", (c) => services.route(facts, classification, questions, c)),
      );
      const path = reviewPath(classification, route, config);
      if (path.council) {
        const selected = selectCards(route, classification, config);
        if (selected.length > 0) {
          const resolved = await loadBundle();
          for (const name of selected) {
            const card = cardSchema.parse(
              await call(`card:${name}`, (c) =>
                services.card(
                  {
                    facts,
                    name,
                    classification,
                    cardPath: resolved.cardPaths[name],
                    agent: resolved.reviewerAgent,
                  },
                  c,
                ),
              ),
            );
            if (card.name !== name) throw new Error("Wrong card returned");
            cards.push(card);
          }
          stage = "cards";
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
                { facts, classification, cards, rating, agent: resolved.voiceAgent },
                c,
              ),
            ),
          );
          validateVoice(cards, voice);
        }
      }
    }
    const result: Review = {
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
    const report = render(result);
    let publication = null;
    if (
      shaSchema.parse(await call("publication-head", (c) => services.head(request, c))) !==
      request.head
    )
      throw new Error("Head moved before publication");
    if (config.publication === "record") {
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
