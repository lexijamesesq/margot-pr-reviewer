import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard, parseVoice } from "../src/adapters/prose.js";

// Every card and voice Margot has actually written and that the repository keeps
// (docs/live, recordings) must parse. The reviewer and the voice write prose; a parser
// that refuses a shape they really produce takes the review down for the operator.
type Sample = { source: string; kind: "card" | "voice"; card?: string; text: string };

function collect(value: unknown, source: string, out: Sample[]) {
  if (typeof value === "string") {
    const text = value.trimStart();
    // A card is the reviewer's whole return (a card line and a completion line); a voice is
    // Margot's return (outcome and band_reason). Labels alone, check text and JSON are neither.
    const card = /^card:\s*([\w-]+)/.exec(text);
    if (card && /^\s*completion:/m.test(text))
      out.push({ source, kind: "card", card: card[1], text: value });
    else if (
      /^\s*(?:\*\*|__)?outcome(?:\*\*|__)?:/im.test(text) &&
      /^\s*(?:\*\*|__)?band_reason(?:\*\*|__)?:/im.test(text) &&
      !/^\s*verdict_source:/m.test(text) && // Python's check text carries the same labels
      !text.startsWith("{")
    )
      out.push({ source, kind: "voice", text: value });
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) collect(v, `${source}[${i}]`, out);
  } else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) collect(v, `${source}.${k}`, out);
}

function samples(): Sample[] {
  const out: Sample[] = [];
  for (const dir of ["docs/live", "recordings"]) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const file = join(dir, name);
      collect(JSON.parse(readFileSync(file, "utf8")), file, out);
    }
  }
  return out;
}

describe("recorded prose", () => {
  const all = samples();
  const cards = all.filter((s) => s.kind === "card");
  const voices = all.filter((s) => s.kind === "voice");

  it("keeps a corpus worth testing", () => {
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(voices.length).toBeGreaterThanOrEqual(1);
  });

  it.each(cards.map((s) => [s.source, s]))("parses the recorded card at %s", (_, s) => {
    expect(() => parseCard(s.text, s.card as string)).not.toThrow();
  });

  it.each(voices.map((s) => [s.source, s]))("parses the recorded voice at %s", (_, s) => {
    expect(() => parseVoice(s.text)).not.toThrow();
  });
});
