import { readFileSync } from "node:fs";
import type { ErrorObject, ValidateFunction } from "ajv";
import AjvModule from "ajv";
import schema from "../../schema/contract-1.schema.json" with { type: "json" };
import type { ContractDocument, GoldenCase, GoldenExpected } from "./types.js";

const ajv = new AjvModule.default({ allErrors: true, strict: true, strictRequired: false });
const validateContract: ValidateFunction<ContractDocument> = ajv.compile<ContractDocument>(schema);

function errorsText(errors: ErrorObject[] | null | undefined): string {
  return ajv.errorsText(errors, { separator: "; " });
}

export function parseContractJson(text: string, source: string): ContractDocument {
  const value: unknown = JSON.parse(text);
  if (!validateContract(value)) {
    throw new Error(`${source}: ${errorsText(validateContract.errors)}`);
  }
  return value;
}

export function readGoldenCase(path: string): GoldenCase {
  const value = parseContractJson(readFileSync(path, "utf8"), path);
  if (!("description" in value)) throw new Error(`${path}: expected case.json`);
  return value;
}

export function readGoldenExpected(path: string): GoldenExpected {
  const value = parseContractJson(readFileSync(path, "utf8"), path);
  if ("description" in value) throw new Error(`${path}: expected expected.json`);
  return value;
}
