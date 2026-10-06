#!/usr/bin/env bash
# margot-runtime entrypoint: sets up a writable config on tmpfs (the root is
# read-only), writes the ticketing MCP config there, and runs the command the
# package passed (`claude ...`) from the read-only base checkout at /work.
set -euo pipefail
die() {
	echo "[margot-runtime ERROR] $*" >&2
	exit 1
}

: "${MARGOT_TMP:=/run/margot}"
[ -d "$MARGOT_TMP" ] || die "expected a writable tmpfs at $MARGOT_TMP (docker run --tmpfs $MARGOT_TMP)"
mkdir -p "$MARGOT_TMP/cc"
export CLAUDE_CONFIG_DIR="$MARGOT_TMP/cc"
export HOME="$MARGOT_TMP" # keep any stray HOME writes on tmpfs, never the read-only image

# gh reads GH_TOKEN (read-scoped) from the environment and never prompts.
export GH_PROMPT_DISABLED=1

# The MCP config carries the ticketing token, so it arrives by environment and is
# written to tmpfs only; the card's permissions deny reading it.
empty='{"mcpServers":{}}'
(
	umask 077
	printf '%s\n' "${MARGOT_MCP_CONFIG:-$empty}" >"$MARGOT_TMP/mcp.json"
)
unset MARGOT_MCP_CONFIG

cd /work || die "no base checkout mounted at /work (docker run --mount ...,target=/work,readonly)"
exec "$@"
