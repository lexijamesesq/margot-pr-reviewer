import { compile } from "json-schema-to-typescript";

const CONSTRAINT_KEYS = new Set(["required", "not", "properties"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function classifyBranch(branch) {
  if (!isObject(branch)) return "real";

  const keys = Object.keys(branch);
  const onlyConstraintKeys = keys.every((key) => CONSTRAINT_KEYS.has(key));
  const propertiesValid =
    branch.properties === undefined ||
    (isObject(branch.properties) &&
      Object.values(branch.properties).every(
        (property) => isObject(property) && Object.keys(property).length === 0,
      ));
  const notValid =
    branch.not === undefined ||
    (isObject(branch.not) &&
      Object.keys(branch.not).length === 1 &&
      Array.isArray(branch.not.required));

  if (onlyConstraintKeys && propertiesValid && notValid) return "constraint";
  if (keys.some((key) => key === "required" || key === "not")) return "unrecognized";
  if (onlyConstraintKeys) return "unrecognized";
  return "real";
}

function describeKinds(branches, kinds) {
  return kinds
    .map((kind, index) => `${index}:${kind} ${JSON.stringify(branches[index])}`)
    .join("; ");
}

export function stripConstraintCombinators(schema) {
  const copy = structuredClone(schema);
  const strippedPaths = [];

  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
      return;
    }
    if (!isObject(value)) return;

    for (const keyword of ["oneOf", "anyOf"]) {
      const branches = value[keyword];
      if (!Array.isArray(branches)) continue;
      const kinds = branches.map(classifyBranch);
      const constraintCount = kinds.filter((kind) => kind === "constraint").length;
      const found = describeKinds(branches, kinds);
      if (kinds.includes("unrecognized")) {
        throw new Error(`${path}.${keyword}: unrecognized constraint branch; found ${found}`);
      }
      if (constraintCount > 0 && constraintCount !== branches.length) {
        throw new Error(
          `${path}.${keyword}: mixed constraint-only and real branches; found ${found}`,
        );
      }
      if (constraintCount === branches.length) {
        delete value[keyword];
        strippedPaths.push(`${path}.${keyword}`);
      }
    }

    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  }

  walk(copy, "$");
  return { schema: copy, strippedPaths };
}

export async function generateTypes(schema) {
  const { schema: strippedSchema, strippedPaths } = stripConstraintCombinators(schema);
  const compiled = await compile(strippedSchema, "ContractDocument", {
    bannerComment: "/*\n * GENERATED FILE. DO NOT EDIT.\n * Regenerate with: pnpm gen:types\n */",
    additionalProperties: false,
  });
  const generated = compiled.replace(/(\.\.\.[^\n]+)\n(\s*\];)/g, "$1,\n$2");
  return { generated, strippedPaths };
}
