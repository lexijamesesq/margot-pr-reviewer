/**
 * The text of a caught value, for diagnostics: an Error's message, otherwise the value
 * converted with `String`. It never throws for an Error or a primitive. It does not
 * redact: callers must not put a credential in an error message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failure the operator can fix by changing configuration; the message names the setting and holds no secret. */
export class ConfigurationError extends Error {}
