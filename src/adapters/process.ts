import { execFile } from "node:child_process";
import { basename } from "node:path";

/** No shell, no inherited output, and no child diagnostics containing credentials. */
export function execute(
  file: string,
  args: string[],
  options: { signal?: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<string> {
  const { input, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { ...spawnOptions, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        // The child's stderr is dropped on purpose: it can echo credentials. The
        // program name and exit code are the only diagnostic that is safe to keep.
        if (error)
          reject(new Error(`Process failed: ${basename(file)} (${error.code ?? "unknown"})`));
        else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {}); // Process exit is reported through the callback.
    child.stdin?.end(input);
  });
}
