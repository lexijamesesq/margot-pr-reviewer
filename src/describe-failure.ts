/** A readable description of a thrown value for the closer's per-check messages. */
export function describeFailure(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  return String(failure);
}
