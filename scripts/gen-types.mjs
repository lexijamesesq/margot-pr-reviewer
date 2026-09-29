import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateTypes } from "./gen-types-lib.mjs";

const root = new URL("../", import.meta.url);
const schema = JSON.parse(await readFile(new URL("schema/contract-1.schema.json", root), "utf8"));
const { generated } = await generateTypes(schema);

if (generated.includes("[k: string]: unknown")) {
  throw new Error(
    "generated types contain `[k: string]: unknown`; inspect the recursive schema walk",
  );
}

await writeFile(new URL("src/contract/types.generated.ts", root), generated);
console.log(`generated ${fileURLToPath(new URL("src/contract/types.generated.ts", root))}`);
