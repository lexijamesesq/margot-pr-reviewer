import { cardSchema, voiceSchema } from "../schemas.js";
import type { Card } from "../types.js";

function field(prose: string, name: string): string {
  const hits = [...prose.matchAll(new RegExp(`^${name}:\\s*(.+)$`, "gmi"))];
  if (hits.length !== 1) throw new Error(`Missing or ambiguous ${name}`);
  return hits[0]?.[1]?.trim() ?? "";
}
function section(prose: string, name: string): string {
  const lines = prose.split(/\r?\n/);
  const starts = lines.flatMap((line, i) =>
    line.toLowerCase() === `${name.toLowerCase()}:` ? [i] : [],
  );
  if (starts.length !== 1) throw new Error(`Missing or ambiguous ${name}`);
  const start = (starts[0] ?? 0) + 1;
  const end = lines.findIndex((line, i) => i >= start && /^[A-Za-z][A-Za-z _]*:/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}
const bullets = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*] /.test(l))
    .map((l) => l.replace(/^\s*[-*] /, "").trim());
export function parseCard(raw: string, name: Card["name"]): Card {
  if (field(raw, "card") !== name || field(raw, "completion") !== "completed")
    throw new Error("Card did not complete");
  const findings = section(raw, "Findings");
  const chunks = findings.split(/(?=^\s*[-*] \[)/m).filter((s) => s.trim());
  const parsed = chunks.map((chunk, index) => {
    const match = chunk.match(
      /^\s*[-*] \[(issue|info)\] (.+?) · severity=(MINOR|MAJOR|BLOCKING) · confidence=(LOW|MEDIUM|HIGH)([^\n]*)\s*\n([\s\S]+)$/,
    );
    if (!match) throw new Error("Unreadable finding");
    const body = (match[6] ?? "").replace(/^\s+/gm, "");
    const extras = Object.fromEntries(
      (match[5] ?? "")
        .split(" · ")
        .filter((x) => x.trim())
        .map((x) => {
          const at = x.indexOf("=");
          if (at < 1 || !["ledger", "late", "reopens"].includes(x.slice(0, at)))
            throw new Error("Unreadable finding attribution");
          return [x.slice(0, at), x.slice(at + 1).trim()];
        }),
    );
    return {
      ...extras,
      id: `${name}-F${index + 1}`,
      tag: match[1],
      location: match[2],
      severity: match[3],
      confidence: match[4],
      what: field(body, "what"),
      detail: `Consequence: ${field(body, "consequence")} ${match[1] === "issue" ? field(body, "action") : field(body, "note")}`,
    };
  });
  // A misplaced tagged finding is an error, not an empty clean card.
  if ((raw.match(/^\s*[-*] \[(?:issue|info)\]/gm) ?? []).length !== parsed.length)
    throw new Error("Finding outside Findings section");
  return cardSchema.parse({
    name,
    completion: "completed",
    checked: bullets(section(raw, "Checked")),
    notCovered: bullets(section(raw, "Not covered")),
    findings: parsed,
    ...(/^Resolved:$/im.test(raw)
      ? {
          resolved: bullets(section(raw, "Resolved")).map((line) => {
            const match = line.match(/^(R[1-9]\d*-F[1-9]\d*) · (.+)$/);
            if (!match) throw new Error("Unreadable resolution");
            return { key: match[1], reason: match[2] };
          }),
        }
      : {}),
  });
}
export function parseVoice(raw: string) {
  const dispositions = ["established", "dismissed"].flatMap((status) =>
    bullets(section(raw, status)).map((line) => {
      const match = line.match(/^([\w-]+) · (.+)$/);
      if (!match) throw new Error("Unreadable disposition");
      return { id: match[1], status, reason: match[2] };
    }),
  );
  return voiceSchema.parse({
    outcome: field(raw, "outcome"),
    band: field(raw, "band"),
    rationale: field(raw, "band_reason"),
    summary: field(raw, "summary"),
    dispositions,
  });
}
