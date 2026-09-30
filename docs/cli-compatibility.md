# Pinned Claude CLI compatibility probe

Tested npm package `@anthropic-ai/claude-code@2.1.283` in an empty temporary working
directory. One authenticated model invocation; no review, Jev or GitHub write calls.
The initial isolated-config attempt had no OAuth login and cost zero. The subsequent
probe used the existing Claude login, without printing or copying credentials.

Exact invocation, with `CLI` pointing to the installed 2.1.283 executable:

```sh
"$CLI" -p 'Return the marker specified by your selected agent as structured output.' \
  --agents '{"probe":{"description":"Compatibility probe","prompt":"The marker is agent-schema-compatible. Return it.","model":"haiku","tools":[]}}' \
  --agent probe \
  --json-schema '{"type":"object","properties":{"marker":{"type":"string"}},"required":["marker"],"additionalProperties":false}' \
  --output-format json --no-session-persistence --setting-sources '' \
  --settings '{"disableAllHooks":true}' --strict-mcp-config \
  --mcp-config '{"mcpServers":{}}' --tools ''
```

Observed: exit 0, envelope type `result`, subtype `success`, `is_error: false`,
`total_cost_usd: 0.002925`. No `structured_output` value was returned. Instead,
`result` contained a fenced JSON object with an `agent_marker` property and extra
metadata, violating the requested schema. It also did not return the marker in
the selected agent's prompt. The schema/agent contract was not honored by this
invocation. The receipt intentionally excludes the model's incidental machine
metadata.

This probe does not isolate whether `--tools ''`, custom-agent selection, or the
combination itself caused the failure. It does establish that this invocation
cannot be the foundation of structured-output tests. No second paid invocation
was made to investigate further.

Decision: do not depend on `--agent` plus `--json-schema`. Slice 1's Zod contracts
validate normalized service responses, independently of CLI transport. Slice 2
will translate the pinned bundle's existing card/voice output convention, retain
raw output, and reject missing or ambiguous accounting. A successful probe with
actual bundle agents and production confinement is needed before adopting a CLI
schema mode instead. The voice model remains in bundle frontmatter. The resolver
must still verify and inject each exact card path; schema mode would not replace
that requirement.
