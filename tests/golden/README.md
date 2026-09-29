# Margot golden fixtures

These 70 contract/1 fixtures were copied from lexijamesesq/margot at
45f12bb406260cc93455dc684e0c0cc78e261565. The schema in
schema/contract-1.schema.json is the language-neutral source of truth.

Contract types are generated from the schema with cross-field constraint-only
branches stripped before generation; those rules are enforced by Ajv against
the full, unmodified schema when a case is loaded, not by the type system. Run
`pnpm gen:types` to regenerate the committed types.

Margot keeps its own copy until cutover. Any live fix that re-records a fixture
must be paired with a re-copy into this engine repository. After cutover,
Margot's copy is deleted and this repository becomes the only copy.

## Seam derivation

Run node tests/golden/prepare-fixtures.mjs after a re-copy. It rewrites only
Margot-instance run URLs and derives case.json's seams in a fixed order:

- council-parse: the adapter replays the driver and expected model requests
  include a reviewer request.
- ledger: the emit round is greater than one, a GitHub reviews response
  contains a Margot-authored ledger, or the case id identifies ledger selection.
  band_basis alone is not a ledger signal.
- risk-verdict: the emit contains band, R, risk/vector data, band_basis,
  ignored_dimensions, raised, or verdict_voice.
- poster: the adapter replays the poster or expected output has a poster result.
- triage: expected outcome.triage is present.
- workflow-steps: the adapter has a workflow replay, expected output has
  outcome.status or outcome.facts, and no driver/poster output.

Every case must match at least one rule or the script fails.

## Comparison

GitHub and Linear reads are order-free stores: missing requested data fails,
while unused stored reads are allowed. Model and Jev requests compare as sets
of distinct content. GitHub writes compare in strict order, including token
identity. Rendered strings and triage JSON strings remain byte-exact.

Canonical JSON rounds numbers to nine decimal places, writes integral results
as integers, preserves booleans, sorts object keys, and uses compact separators.
Worked example:

    input:  {"z":[1.0000000001],"risk":{"tail":0.30000000004,"safe":true,"R":1.0}}
    output: {"risk":{"R":1,"safe":true,"tail":0.3},"z":[1]}
