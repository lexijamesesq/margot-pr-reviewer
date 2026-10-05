/** The message of a caught value, for diagnostics. Messages never carry credentials. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
