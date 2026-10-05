/** Narrows a value a test expects to exist, failing with a clear message when it does not. */
export function present<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`Test expected ${what} to be present`);
  return value;
}
