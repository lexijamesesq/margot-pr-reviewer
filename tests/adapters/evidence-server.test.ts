import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Octokit } from "octokit";
import { describe, expect, it } from "vitest";
import { createEvidenceServer } from "../../src/adapters/evidence-server.js";
import { githubAdapter } from "../../src/adapters/github.js";
import type { Recording } from "../../src/index.js";
import { connectEvidence, github, request } from "../helpers/adapters.js";
import { present } from "../present.js";

describe("the evidence server's repository tools", () => {
  it("keeps a caller-supplied repository and SHA out of evidence routing", async () => {
    const calls: unknown[] = [];
    const server = createEvidenceServer(
      { request },
      {
        ...github().adapter,
        async readFile(r, path, revision) {
          calls.push({ r, path, revision });
          return "safe file";
        },
      },
    );
    const { client, close } = await connectEvidence(server);
    try {
      await client.callTool({
        name: "read_file",
        arguments: {
          path: "a.ts",
          revision: "head",
          repository: "attacker/repo",
          head: "f".repeat(40),
        },
      });
      expect(calls).toEqual([{ r: request, path: "a.ts", revision: "head" }]);
    } finally {
      await close();
    }
  });

  it("exposes only repository read tools", async () => {
    const { client, close } = await connectEvidence(
      createEvidenceServer({ request }, github().adapter),
    );
    try {
      expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
        "list_files",
        "read_file",
        "search_file",
      ]);
    } finally {
      await close();
    }
  });

  it("reads a large evidence file in bounded numbered ranges", async () => {
    const server = createEvidenceServer(
      { request },
      {
        ...github().adapter,
        async readFile() {
          return Array.from({ length: 700 }, (_, i) => `line-${i + 1}`).join("\n");
        },
      },
    );
    const { client, close } = await connectEvidence(server);
    try {
      const result = JSON.stringify(
        await client.callTool({
          name: "read_file",
          arguments: { path: "large.ts", start_line: 601, max_lines: 2 },
        }),
      );
      expect(result).toContain("601: line-601");
      expect(result).toContain("602: line-602");
      expect(result).not.toContain("603: line-603");
    } finally {
      await close();
    }
  });

  it("locates literal search text without executing it", async () => {
    const server = createEvidenceServer(
      { request },
      {
        ...github().adapter,
        async readFile() {
          return "other\ncheck-yaml\nend";
        },
      },
    );
    const { client, close } = await connectEvidence(server);
    try {
      const result = await client.callTool({
        name: "search_file",
        arguments: { path: "test.ts", text: "check-yaml" },
      });
      expect(JSON.stringify(result)).toContain("2: check-yaml");
    } finally {
      await close();
    }
  });
});

describe("bound evidence", () => {
  const source = JSON.parse(
    readFileSync(new URL("../../recordings/council-clear.json", import.meta.url), "utf8"),
  ) as Recording;
  const oldHead = "b".repeat(40);

  it("returns the complete bound diff through the paged read_diff tool", async () => {
    const directory = await mkdtemp(`${tmpdir()}/margot-diff-`);
    const path = `${directory}/diff`;
    const input = "abcdef".repeat(6000);
    await writeFile(path, input);
    const { client, close } = await connectEvidence(
      createEvidenceServer({ request: source.request, diffPath: path }),
    );
    try {
      let offset = 0,
        out = "";
      do {
        const response = await client.callTool({
          name: "read_diff",
          arguments: { offset, limit: 16000 },
        });
        const content = response.content as { text: string }[];
        const chunk = JSON.parse(present(content[0]).text);
        out += chunk.text;
        offset = chunk.end;
        if (offset === chunk.total) break;
      } while (offset < input.length);
      expect(out).toBe(input);
    } finally {
      await close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps reference reads bound to the configured repository and SHA", async () => {
    let observed: unknown;
    const { client, close } = await connectEvidence(
      createEvidenceServer(
        {
          request: source.request,
          references: { hooks: { repository: "reference/hooks", head: oldHead } },
        },
        {
          ...githubAdapter(new Octokit()),
          async readFile(r, path) {
            observed = { repository: r.repository, head: r.head, path };
            return "pinned source";
          },
        },
      ),
    );
    try {
      await client.callTool({
        name: "read_reference",
        arguments: {
          reference: "hooks",
          path: "hook.ts",
          head: "f".repeat(40),
          repository: "forged/repo",
        },
      });
      expect(observed).toMatchObject({
        repository: "reference/hooks",
        head: oldHead,
        path: "hook.ts",
      });
    } finally {
      await close();
    }
  });

  it("refuses an unconfigured reference without a GitHub read", async () => {
    let calls = 0;
    const { client, close } = await connectEvidence(
      createEvidenceServer(
        {
          request: source.request,
          references: { hooks: { repository: "reference/hooks", head: oldHead } },
        },
        {
          ...githubAdapter(new Octokit()),
          async readFile() {
            calls++;
            return "pinned source";
          },
        },
      ),
    );
    try {
      const result = await client.callTool({
        name: "read_reference",
        arguments: { reference: "unconfigured", path: "hook.ts" },
      });
      expect({ error: result.isError === true, calls }).toEqual({ error: true, calls: 0 });
    } finally {
      await close();
    }
  });
});
