import { execFile } from "node:child_process";

/** No shell, no inherited output, and no child diagnostics containing credentials. */
export function execute(
  file: string,
  args: string[],
  options: { signal?: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { ...options, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(
            new Error(`Process failed: ${file.split("/").at(-1)} (${error.code ?? "unknown"})`),
          );
        else resolve(stdout);
      },
    );
    child.stdin?.end();
  });
}
