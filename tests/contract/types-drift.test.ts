import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import schema from "../../schema/contract-1.schema.json" with { type: "json" };
import { generateTypes, stripConstraintCombinators } from "../../scripts/gen-types-lib.mjs";

const generatedPath = new URL("../../src/contract/types.generated.ts", import.meta.url);

describe("contract type generation", () => {
  test("generated contract types are byte-identical to the schema output", async () => {
    const { generated, strippedPaths } = await generateTypes(schema);
    expect(strippedPaths).toEqual([
      "$.definitions.read.oneOf",
      "$.definitions.writeResponse.oneOf",
      "$.definitions.case.properties.source.anyOf[1].oneOf",
      "$.definitions.expected.anyOf",
    ]);
    expect(readFileSync(generatedPath, "utf8"), "run `pnpm gen:types` to regenerate").toBe(
      generated,
    );
  });

  test("constraint classifier rejects mixed constraint-only and real branches", () => {
    const mixed = {
      oneOf: [{ required: ["a"] }, { required: ["b"], type: "object" }],
    };
    expect(() => stripConstraintCombinators(mixed)).toThrow(
      /\$\.oneOf: unrecognized constraint branch/,
    );
  });
});
