import { readFileSync } from "node:fs";
import type { ErrorObject, ValidateFunction } from "ajv";
import AjvModule from "ajv";
import schema from "../../schema/contract-1.schema.json" with { type: "json" };
import type { Case, Expected, MargotGoldenContract1 } from "./types.js";

const ajv = new AjvModule.default({ allErrors: true, strict: true, strictRequired: false });
const validateContract: ValidateFunction<MargotGoldenContract1> =
  ajv.compile<MargotGoldenContract1>(schema);

function errorsText(errors: ErrorObject[] | null | undefined): string {
  return ajv.errorsText(errors, { separator: "; " });
}

export function parseContractJson(text: string, source: string): MargotGoldenContract1 {
  const value: unknown = JSON.parse(text);
  if (!validateContract(value)) {
    throw new Error(`${source}: ${errorsText(validateContract.errors)}`);
  }
  return value;
}

export function readGoldenCase(path: string): Case {
  const value = parseContractJson(readFileSync(path, "utf8"), path);
  if (!("description" in value)) throw new Error(`${path}: expected case.json`);
  return value;
}

export function readGoldenExpected(path: string): Expected {
  const value = parseContractJson(readFileSync(path, "utf8"), path);
  if ("description" in value) throw new Error(`${path}: expected expected.json`);
  return value;
}
