import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import parseDiff from "parse-diff";
import { diffIsComplete } from "./diff.js";
import { comparisonSchema, ledgerSchema } from "./schemas.js";
import type {
  Card,
  Convergence,
  Facts,
  Ledger,
  ReviewConfig,
  ReviewCore,
  RoundScope,
  Voice,
} from "./types.js";

export const configHash = (config: ReviewConfig): string =>
  createHash("sha256")
    .update(`ledger-v2:${JSON.stringify(config)}`)
    .digest("hex");

export const evidenceHash = (facts: Facts): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        repository: facts.repository,
        pr: facts.pr,
        base: facts.base,
        head: facts.head,
        title: facts.title,
        body: facts.body,
        author: facts.author,
        diff: facts.diff,
        files: facts.files,
        triage: facts.triage,
        ownedPathTier: facts.ownedPathTier,
      }),
    )
    .digest("hex");

/** Only trailing blocks claim history; prose mentions cannot hide the App's ledger.
 * Untrusted or undecodable blocks are skipped, preserving older App history.
 */
export function selectLedger(facts: Facts, config: ReviewConfig): Ledger | null {
  if (!facts.history.complete) return null;
  if (facts.history.priorLedger && !facts.history.reviews) return null;
  const reviews = [...(facts.history.reviews ?? [])].sort(
    (a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id - a.id,
  );
  for (const review of reviews) {
    const match = review.body.match(/(?:^|\n)<!-- margot-ledger:v([12]) ([A-Za-z0-9+/=]+) -->\s*$/);
    if (!match) continue;
    if (review.actorType !== "Bot" || !config.trustedLedgerActors.includes(review.actor)) continue;
    try {
      let decoded = JSON.parse(
        (match[1] === "2"
          ? inflateSync(Buffer.from(match[2] ?? "", "base64"), { maxOutputLength: 1048576 })
          : Buffer.from(match[2] ?? "", "base64")
        ).toString("utf8"),
      );
      let version = Number(match[1]);
      // The legacy reader ignores this extension and sees the same plain entries.
      // Margot restores her saved receipt without maintaining a second ledger.
      if (version === 1 && decoded && typeof decoded.receipt_v2 === "string") {
        const { receipt_v2, ...legacy } = decoded;
        if (legacy.v !== 1 || "receipt" in legacy) throw new Error("Invalid rollback ledger");
        decoded = {
          ...legacy,
          v: 2,
          receipt: JSON.parse(
            inflateSync(Buffer.from(receipt_v2, "base64"), { maxOutputLength: 1048576 }).toString(
              "utf8",
            ),
          ),
        };
        version = 2;
      }
      const ledger = ledgerSchema.parse(decoded);
      if (ledger.v !== version || ledger.head !== review.head)
        throw new Error("Ledger revision mismatch");
      if (
        ledger.receipt &&
        (ledger.receipt.review.request.repository !== facts.repository ||
          ledger.receipt.review.request.pr !== facts.pr)
      )
        throw new Error("Ledger belongs to another PR");
      return ledger;
    } catch {}
  }
  return null;
}

/** Unified diff is the inventory: the compare JSON file list is capped at 300. */
export function roundScope(facts: Facts, prior: Ledger | null, comparison?: unknown): RoundScope {
  const full: RoundScope = {
    round: prior ? prior.round + 1 : 1,
    priorHead: prior?.head ?? null,
    full: true,
    diff: facts.diff,
    files: facts.files,
    entries: prior?.entries ?? [],
  };
  if (!prior) return full;
  if (prior.head === facts.head) {
    if (prior.round < 2) return { ...full, round: 1, priorHead: null, entries: [] };
    return { ...full, round: prior.round, full: false, diff: "", files: [] };
  }
  const parsed = comparisonSchema.safeParse(comparison);
  if (!parsed.success) return full;
  const delta = parsed.data;
  if (delta.base !== prior.head || delta.head !== facts.head)
    throw new Error("Delta revision mismatch");
  if (!delta.complete || !["ahead", "identical"].includes(delta.status)) return full;
  const files = parseDiff(delta.diff);
  if (!diffIsComplete(delta.diff, files)) return full;
  const own = new Set(
    facts.files.flatMap((f) => [f.path, ...(f.previousPath ? [f.previousPath] : [])]),
  );
  const chunks = delta.diff.split(/(?=^diff --git )/m).filter((s) => s.trim());
  const selected = files.flatMap((f, i) =>
    own.has(f.to ?? "") || own.has(f.from ?? "") ? [i] : [],
  );
  return {
    ...full,
    full: false,
    diff: selected.map((i) => chunks[i]).join(""),
    files: selected.map((i) => {
      const f = files[i];
      const path = f?.to === "/dev/null" ? f.from : f?.to;
      if (!path) throw new Error("Unreadable delta path");
      return {
        path,
        ...(f?.from && f.from !== path && f.from !== "/dev/null" ? { previousPath: f.from } : {}),
      };
    }),
  };
}
export const standingCards = (scope: RoundScope): Card["name"][] => [
  ...new Set(
    scope.entries.filter((e) => ["standing", "advisory"].includes(e.status)).map((e) => e.card),
  ),
];

/** Python's `_late_missed`: a `late=` mark that starts with `missed`, with or without a reason. */
const lateMissed = (late: string | undefined): boolean => /^missed\b/i.test(late ?? "");

/** Matching, reach and fix evidence are model judgments; severity and memory are code. */
export function prepareFindings(cards: Card[], scope: RoundScope): void {
  for (const card of cards) {
    for (const finding of card.findings) {
      // These are Margot's own annotations, never accepted from a card.
      if (finding.unconfirmed !== undefined || finding.advisory !== undefined)
        throw new Error("Card supplied Margot's own annotations");
      if (
        finding.ledger &&
        !scope.entries.some(
          (e) =>
            e.key === finding.ledger &&
            e.card === card.name &&
            ["standing", "dismissed", "advisory"].includes(e.status),
        )
      )
        throw new Error("Unknown or foreign ledger key");
      if (finding.tag !== "issue" || scope.round < 2) continue;
      const entry = scope.entries.find((e) => e.key === finding.ledger);
      if (!entry && !scope.full && !finding.late)
        throw new Error("New finding needs delta or late attribution");
      if (entry?.status === "dismissed" && !finding.reopens) finding.advisory = "carried-dismissal";
      else if (finding.severity === "MINOR") finding.advisory = "minor-after-round-1";
      else if (
        ((!entry && !scope.full && lateMissed(finding.late)) ||
          (entry?.status === "advisory" &&
            lateMissed(entry.late) &&
            !finding.late?.startsWith("reach:"))) &&
        finding.severity !== "BLOCKING" &&
        card.name !== "safety"
      )
        finding.advisory = "late-non-blocking";
    }
    for (const entry of scope.entries.filter(
      (e) => e.card === card.name && e.status === "standing",
    )) {
      if (card.findings.some((f) => f.ledger === entry.key && f.tag === "issue")) continue;
      if (scope.round >= 2 && entry.severity === "MINOR") continue;
      card.findings.push({
        id: `verify-${entry.key}`,
        tag: "issue",
        severity: entry.severity,
        confidence: "LOW",
        location: entry.location,
        what: entry.what,
        ledger: entry.key,
        unconfirmed: true,
      });
    }
  }
  if (standingCards(scope).some((name) => !cards.some((c) => c.name === name)))
    throw new Error("Standing card did not complete");
}

export function nextLedger(
  scope: RoundScope,
  cards: Card[],
  voice: Voice | null,
  core: ReviewCore,
  config: ReviewConfig,
  facts: Facts,
): { ledger: Ledger; convergence: Convergence } {
  const entries = new Map(scope.entries.map((e) => [e.key, { ...e }]));
  const counts: Convergence = {
    round: scope.round,
    standing: 0,
    fixed: 0,
    new: 0,
    late: 0,
    unconfirmed: 0,
  };
  const dispositions = new Map(voice?.dispositions.map((d) => [d.id, d]) ?? []);
  let index = Math.max(
    0,
    ...scope.entries
      .filter((e) => e.key.startsWith(`R${scope.round}-F`))
      .map((e) => Number(e.key.split("-F")[1])),
  );
  const upheld = new Set(
    cards.flatMap((c) =>
      c.findings
        .filter((f) => !f.advisory && (!f.id || dispositions.get(f.id)?.status !== "dismissed"))
        .map((f) => f.ledger),
    ),
  );
  for (const card of cards) {
    // Fixed-ness is inferred from absence, as Python infers it: no card parses a `Resolved:`
    // section. An entry that can no longer block (advisory, or MINOR from round two) its card
    // stops raising is fixed without a ruling.
    const raised = (key: string) =>
      card.findings.some((f) => f.ledger === key && f.tag === "issue");
    for (const entry of scope.entries.filter(
      (e) => e.card === card.name && e.status === "advisory",
    )) {
      if (!raised(entry.key))
        entries.set(entry.key, {
          ...entry,
          status: "fixed",
          fixed_round: scope.round,
          reason: "Card completed and no longer raised this advisory finding",
        });
    }
    for (const entry of scope.entries.filter(
      (e) => e.card === card.name && e.status === "standing" && e.severity === "MINOR",
    )) {
      if (scope.round >= 2 && !raised(entry.key)) {
        entries.set(entry.key, {
          ...entry,
          status: "fixed",
          fixed_round: scope.round,
          reason: "Card completed and no longer raised this MINOR finding",
        });
        counts.fixed++;
      }
    }
    for (const f of card.findings) {
      if (f.tag !== "issue") continue;
      if (!f.ledger && !scope.full && lateMissed(f.late)) counts.late++;
      if (f.unconfirmed) counts.unconfirmed++;
      if (f.advisory) {
        const old = f.ledger ? entries.get(f.ledger) : undefined;
        if (!old || (["standing", "advisory"].includes(old.status) && !upheld.has(f.ledger))) {
          const key = old?.key ?? `R${scope.round}-F${++index}`;
          entries.set(key, {
            key,
            card: card.name,
            round_raised: old?.round_raised ?? scope.round,
            location: f.location,
            what: f.what,
            severity: f.severity,
            status: "advisory",
            advisory_round: scope.round,
            ...(f.late ? { late: f.late } : old?.late ? { late: old.late } : {}),
          });
        }
        continue;
      }
      const ruling = f.id ? dispositions.get(f.id) : undefined;
      // Under Margot's own ERROR ruling an unaccounted finding is legitimate (Python skips it);
      // under any other outcome the voice already accounted for every one.
      if (!ruling) {
        if (core.decision.outcome === "ERROR") continue;
        throw new Error("Ledger finding has no ruling");
      }
      const key = f.ledger ?? `R${scope.round}-F${++index}`;
      const old = entries.get(key);
      if (!f.ledger) counts.new++;
      if (f.ledger && upheld.has(key) && ruling.status === "dismissed") continue;
      const fixed = ruling.status === "dismissed" && f.unconfirmed === true;
      const entry: Ledger["entries"][number] = {
        key,
        card: card.name,
        round_raised: old?.round_raised ?? scope.round,
        location: f.location,
        what: f.what,
        severity: f.severity,
        status: fixed ? "fixed" : ruling.status === "dismissed" ? "dismissed" : "standing",
        reason: ruling.reason,
        ...(f.late ? { late: f.late } : old?.late ? { late: old.late } : {}),
        ...(fixed ? { fixed_round: scope.round } : {}),
      };
      entries.set(key, entry);
    }
  }
  counts.fixed += [...entries.values()].filter(
    (e) => e.status === "fixed" && e.fixed_round === scope.round && e.severity !== "MINOR",
  ).length;
  counts.standing = [...entries.values()].filter((e) => e.status === "standing").length;
  if (counts.standing > 0 && core.decision.outcome === "APPROVED")
    throw new Error("Approval contradicts standing ledger");
  const ledger = ledgerSchema.parse({
    v: 2,
    head: core.request.head,
    round: scope.round,
    entries: [...entries.values()]
      .filter(
        (e) =>
          ["standing", "dismissed"].includes(e.status) ||
          e.fixed_round === scope.round ||
          e.advisory_round === scope.round,
      )
      .map((e) => ({
        ...e,
        location: e.location.slice(0, 240),
        what: e.what.slice(0, 240),
        ...(e.reason ? { reason: e.reason.slice(0, 300) } : {}),
      })),
    receipt: {
      configHash: configHash(config),
      evidenceHash: evidenceHash(facts),
      review: core,
      counts,
    },
  });
  return { ledger, convergence: counts };
}
function encodeLedger(ledger: Ledger): string {
  const raw = Buffer.from(JSON.stringify(ledger));
  const { receipt, ...fields } = ledger;
  const transport =
    ledger.v === 2
      ? Buffer.from(
          JSON.stringify({
            ...fields,
            v: 1,
            receipt_v2: deflateSync(Buffer.from(JSON.stringify(receipt)), { level: 9 }).toString(
              "base64",
            ),
          }),
        )
      : raw;
  const encoded = transport.toString("base64");

  return `<!-- margot-ledger:v1 ${encoded} -->`;
}

/** Drop oldest dismissals, then current fixed/advisory entries; never standing. */
export function ledgerBlock(ledger: Ledger): string {
  const trimmed = structuredClone(ledger);
  const droppable = trimmed.entries
    .filter((e) => e.status !== "standing")
    .sort(
      (a, b) =>
        Number(a.status !== "dismissed") - Number(b.status !== "dismissed") ||
        a.round_raised - b.round_raised,
    );
  while ((encodeLedger(trimmed).split(" ")[2]?.length ?? 0) > 24000 && droppable.length) {
    const gone = droppable.shift();
    trimmed.entries = trimmed.entries.filter((e) => e !== gone);
  }
  // The optional replay receipt must not consume Python's standing-entry budget.
  if ((encodeLedger(trimmed).split(" ")[2]?.length ?? 0) > 24000 && trimmed.receipt) {
    delete trimmed.receipt;
    trimmed.v = 1;
  }
  return encodeLedger(trimmed);
}
