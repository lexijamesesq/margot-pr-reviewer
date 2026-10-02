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

const voiceOutcomes = ["APPROVED", "CHANGES_REQUESTED", "CLARIFICATION_REQUESTED"] as const;
const voiceBands = ["LOW", "MEDIUM", "HIGH"] as const;

function undecorateKey(line: string): string {
  return line.replace(/^(\s*)[*_`]+([A-Za-z][A-Za-z_]*?)[*_`]*:[*_`]*/, "$1$2:");
}

function voiceToken(value: string | undefined, vocabulary: readonly string[]): string {
  const raw = value?.trim() ?? "";
  const stripped = raw
    .replace(/^[*_`]+|[*_`]+$/g, "")
    .replace(/[.!]+$/, "")
    .replace(/^[*_`]+|[*_`]+$/g, "")
    .trim();
  return vocabulary.includes(stripped.toUpperCase()) ? stripped.toUpperCase() : raw;
}

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
    if (status && trimmed.startsWith("-")) {
      const disposition = voiceDisposition(trimmed.replace(/^-\s+/, ""), status);
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
    dispositions,
  });
}
