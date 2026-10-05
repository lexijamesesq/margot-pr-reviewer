import { cardSchema, voiceSchema } from "../schemas.js";
import type { Card } from "../types.js";

// Every shape below follows the same rule: labels at line start, first match wins, tolerated
// markdown decoration, and no refusal beyond what that rule requires.

/** `**Label:** value` / `_label_: value` → `Label: value`; labels may hold spaces. */
function undecorateKey(line: string): string {
  return line.replace(/^(\s*)[*_`]+([A-Za-z][A-Za-z_ ]*?)[*_`]*:[*_`]*/, "$1$2:");
}

/** A value without emphasis or trailing punctuation, upper-cased when it is in the vocabulary. */
function voiceToken(value: string | undefined, vocabulary: readonly string[]): string {
  const raw = value?.trim() ?? "";
  const stripped = raw
    .replace(/^[*_`]+|[*_`]+$/g, "")
    .replace(/[.!]+$/, "")
    .replace(/^[*_`]+|[*_`]+$/g, "")
    .trim();
  return vocabulary.includes(stripped.toUpperCase()) ? stripped.toUpperCase() : raw;
}

/** The first `name: value` line, or undefined; a later mention in free text never matters. */
function firstField(prose: string, name: string): string | undefined {
  return prose.match(new RegExp(`^\\s*${name}:\\s*(.*?)\\s*$`, "mi"))?.[1];
}
/** The bullets under the first `Name:` label, up to the next label line; absent → none. */
function section(prose: string, name: string): string[] {
  const lines = prose.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `${name.toLowerCase()}:`);
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && /^[A-Za-z][A-Za-z _]*:/.test(line));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .filter((l) => /^\s*[-*] /.test(l))
    .map((l) => l.replace(/^\s*[-*] /, "").trim());
}

// A tagged finding bullet: `- [issue] …` / `- **[info]** …`.
const tagBullet = /^\s*(?:[-*]|\d+\.)\s*[*_ ]*\[\s*(issue|info)\s*\][*_ ]*\s*(.*?)\s*$/i;
const severities = ["MINOR", "MAJOR", "BLOCKING"] as const;
const confidences = ["LOW", "MEDIUM", "HIGH"] as const;

/** `<location> · k=v · k=v` → location and lower-cased keys; first key wins, values undecorated. */
function findingFields(rest: string): { location: string; fields: Map<string, string> } {
  const parts = rest.split("·").map((p) => p.trim());
  const fields = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    if (!fields.has(key))
      fields.set(
        key,
        part
          .slice(at + 1)
          .trim()
          .replace(/^[*_` ]+|[*_` ]+$/g, ""),
      );
  }
  return { location: parts[0] ?? "", fields };
}

/** The indented sub-lines after a finding bullet, up to a blank line or the next bullet. */
function subFields(lines: string[], index: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of lines.slice(index + 1)) {
    if (!line.trim() || tagBullet.test(line)) break;
    const match = line.trim().match(/^(what|note|consequence|action)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = (match[1] ?? "").toLowerCase();
    out.set(key, [...(out.get(key) ?? []), (match[2] ?? "").trim()]);
  }
  return out;
}

/** One card's prose. Findings carry no ids yet: the council assigns a global F1…Fn once
 * every card has parsed (`assignFindingIds` in policy). */
export function parseCard(prose: string, name: Card["name"]): Card {
  const raw = prose.split(/\r?\n/).map(undecorateKey).join("\n");
  const completionLine = firstField(raw, "completion");
  const [token = "", ...reason] = (completionLine ?? "").split(":");
  const completion = voiceToken(token, ["COMPLETED", "INCOMPLETE", "SKIPPED"]).toLowerCase();
  if (completion !== "completed" && completion !== "incomplete" && completion !== "skipped")
    throw new Error("Card did not complete");
  const completionReason = reason.join(":").trim();
  const lines = raw.split(/\r?\n/);
  const findings = lines.flatMap((line, index) => {
    const bullet = line.match(tagBullet);
    if (!bullet) return [];
    const tag = (bullet[1] ?? "").toLowerCase();
    const { location, fields } = findingFields(bullet[2] ?? "");
    const severity = fields.get("severity")?.toUpperCase() ?? "";
    const confidence = fields.get("confidence")?.toUpperCase() ?? "";
    if (
      !location ||
      !(severities as readonly string[]).includes(severity) ||
      !(confidences as readonly string[]).includes(confidence)
    )
      throw new Error("Unreadable finding");
    const sub = subFields(lines, index);
    // `what` is the first `what:`/`note:` sub-line; the run-only fields take the last.
    const what = sub.get("what")?.[0] ?? sub.get("note")?.[0] ?? "";
    const consequence = sub.get("consequence")?.at(-1) ?? "";
    const action = (tag === "issue" ? sub.get("action") : sub.get("note"))?.at(-1) ?? "";
    const detail = [consequence ? `Consequence: ${consequence}` : "", action]
      .filter(Boolean)
      .join(" ");
    const ledger = fields.get("ledger") ?? "";
    const late = fields.get("late") ?? "";
    const reopens = fields.get("reopens") ?? "";
    return [
      {
        tag,
        location,
        severity,
        confidence,
        what,
        ...(detail ? { detail } : {}),
        ...(/^R[1-9]\d*-F[1-9]\d*$/.test(ledger) ? { ledger } : {}),
        ...(late ? { late } : {}),
        ...(reopens ? { reopens } : {}),
      },
    ];
  });
  return cardSchema.parse({
    name,
    completion,
    ...(completionReason ? { completionReason } : {}),
    checked: section(raw, "Checked"),
    notCovered: section(raw, "Not covered"),
    findings,
  });
}

const voiceOutcomes = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "CLARIFICATION_REQUESTED",
  "ERROR",
] as const;
const voiceBands = ["LOW", "MEDIUM", "HIGH"] as const;

function voiceDisposition(line: string, status: "established" | "dismissed") {
  const match = line.match(
    /^((?:\*\*[\w-]+\*\*|__[\w-]+__|\*[\w-]+\*|_[\w-]+_|`[\w-]+`|[\w-]+))(?=\s*(?:·|—|:|$))/,
  );
  if (!match) return null;
  const id = (match[1] ?? "").replace(/^(?:\*\*|__|\*|_|`)|(?:\*\*|__|\*|_|`)$/g, "");
  const reason = line
    .slice((match[1] ?? "").length)
    .trim()
    .replace(/^(?:·|—|:)\s*/, "");
  return { id, status, reason };
}

export function parseVoice(raw: string) {
  let lines = raw.split(/\r?\n/).map(undecorateKey);
  const bareOutcome = new RegExp(
    `^\\s*outcome:\\s*[*_\`]*(?:${voiceOutcomes.join("|")})[*_\`]*[.!]?\\s*$`,
    "i",
  );
  const strict = lines.flatMap((line, index) => (bareOutcome.test(line) ? [index] : []));
  const loose = lines.flatMap((line, index) => (/^\s*outcome:/i.test(line) ? [index] : []));
  const start = strict.at(-1) ?? loose.at(-1);
  if (start !== undefined) lines = lines.slice(start);

  // The scalar read: within the final block, the first line carrying a label wins.
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(
      /^\s*(outcome|band_reason|band|risk|summary|finding|clarification):\s*(.*)$/i,
    );
    const key = match?.[1]?.toLowerCase();
    if (key && !fields.has(key)) fields.set(key, match?.[2]?.trim() ?? "");
  }

  const dispositions: Array<{
    id: string;
    status: "established" | "dismissed";
    reason: string;
  }> = [];
  let status: "established" | "dismissed" | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^established:/i.test(trimmed)) {
      status = "established";
      continue;
    }
    if (/^dismissed:/i.test(trimmed)) {
      status = "dismissed";
      continue;
    }
    if (status && (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed) || /^#{1,6}(?:\s|$)/.test(trimmed))) {
      status = null;
      continue;
    }
    if (status && /^[-*]\s/.test(trimmed)) {
      const disposition = voiceDisposition(trimmed.replace(/^[-*]\s+/, ""), status);
      if (disposition) dispositions.push(disposition);
    } else if (status && trimmed) {
      status = null;
    }
  }

  return voiceSchema.parse({
    outcome: voiceToken(fields.get("outcome"), voiceOutcomes),
    band: voiceToken(fields.get("band"), voiceBands),
    rationale: fields.get("band_reason"),
    summary: fields.get("summary"),
    ...(fields.has("risk") ? { risk: fields.get("risk") } : {}),
    ...(fields.has("clarification") ? { clarification: fields.get("clarification") } : {}),
    ...(fields.has("finding") ? { finding: fields.get("finding") } : {}),
    dispositions,
  });
}
