import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const directory = new URL("../recordings/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".json"));
assert.equal(files.length, 7);
const forbidden =
  /lexijamesesq|core-skills|dotty|incubator|metrics|\/Users\/|\/home\/|\/private\/|https?:\/\/|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-ant-|\.internal\b|\.local\b|session_[A-Za-z0-9]/i;
for (const file of files) {
  const contents = readFileSync(new URL(file, directory), "utf8");
  assert.equal(forbidden.test(contents), false, `Identifying residue in ${file}`);
  const strings = (value) =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, item]) => [key, ...strings(item)])
        : [];
  for (const value of strings(JSON.parse(contents))) {
    if (value.startsWith("/"))
      assert.match(value, /^\/recorded-bundle\/skills\/pr-council\/playbooks\/[a-z-]+\.md$/);
  }
}
const placeholderShas = new Set(["0123abcd", "1234abc", "2345bcd"]);
const proseDirectory = new URL("prose/", directory);
const proseFiles = readdirSync(proseDirectory).filter((name) => name.endsWith(".txt"));
assert.equal(proseFiles.length, 8);
for (const file of proseFiles) {
  const contents = readFileSync(new URL(file, proseDirectory), "utf8");
  assert.equal(forbidden.test(contents), false, `Identifying residue in prose/${file}`);
  assert.equal(
    /#\d{2,}|\b[A-Z]{2,}-\d+\b/.test(contents),
    false,
    `PR number or ticket key in prose/${file}`,
  );
  for (const sha of contents.match(/\b[0-9a-f]{7,40}\b/g) ?? [])
    assert.ok(placeholderShas.has(sha), `Real-looking SHA ${sha} in prose/${file}`);
}
console.log(
  "7 recordings and 8 prose samples: no denylisted identity, credential, host or machine-path residue",
);
