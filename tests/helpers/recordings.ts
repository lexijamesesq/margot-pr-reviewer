import { readFileSync } from "node:fs";
import type { Recording } from "../../src/adapters/recorded.js";

/** The one way tests read a shipped recording, resolved from this file so any working directory works. */
export function readRecording(name: string): Recording {
  return JSON.parse(
    readFileSync(new URL(`../../recordings/${name}.json`, import.meta.url), "utf8"),
  ) as Recording;
}
