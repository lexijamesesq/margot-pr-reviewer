function normalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("contract JSON numbers must be finite");
    return Number(value.toFixed(9));
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  throw new Error("value is not JSON");
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}
