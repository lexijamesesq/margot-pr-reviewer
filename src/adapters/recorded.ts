import type { Services } from "../types.js";

/** Normalized service recordings, not raw CLI transcripts. Values are still untrusted. */
export interface Recording {
  provenance: string;
  request: unknown;
  config: unknown;
  facts: unknown;
  classification: unknown;
  comparison?: unknown;
  route: unknown;
  risk: unknown;
  bundle: unknown;
  cards: Record<string, unknown>;
  voice: unknown;
  head: unknown;
  disableAutoMerge: unknown;
  publication: unknown;
  failures?: Record<string, string>;
  /** The advisory template-adherence answer; a recording without one reads as unchecked. */
  adherence?: unknown;
}
export function recordedServices(
  recording: Recording,
): Services & { calls: { name: string; input: unknown }[]; publications: unknown[] } {
  const data = structuredClone(recording);
  const calls: { name: string; input: unknown }[] = [];
  const publications: unknown[] = [];
  const read = async (name: string, input: unknown, value: unknown): Promise<unknown> => {
    calls.push({ name, input: structuredClone(input) });
    if (data.failures?.[name] === "never-returns") return new Promise(() => {});
    if (data.failures?.[name]) throw new Error(data.failures[name]);
    if (value === undefined) throw new Error(`Missing recording: ${name}`);
    return structuredClone(value);
  };
  return {
    provenance: data.provenance,
    reviewMetadata: () => ({ costUsd: 0, durationMs: 0 }),
    calls,
    publications,
    facts: (request) => read("facts", request, data.facts),
    adherence: (input) => read("adherence", input, data.adherence),
    compare: (request, priorHead) => read("compare", { request, priorHead }, data.comparison),
    classify: (facts, questions) =>
      read("classification", { facts, questions }, data.classification),
    route: (facts, classification, questions) =>
      read("route", { facts, classification, questions }, data.route),
    risk: (facts, cards, questions) => read("risk", { facts, cards, questions }, data.risk),
    bundle: (commit) => read("bundle", commit, data.bundle),
    card: (input) => read(`card:${input.name}`, input, data.cards[input.name]),
    voice: (input) => read("voice", input, data.voice),
    head: (request) => read("head", request, data.head),
    disableAutoMerge: (request) => read("disableAutoMerge", request, data.disableAutoMerge),
    publish: async (input) => {
      const receipt = await read("publish", input, data.publication);
      if (input.expectedHead !== data.head) throw new Error("Publication head mismatch");
      publications.push(structuredClone(input));
      return receipt;
    },
  };
}
