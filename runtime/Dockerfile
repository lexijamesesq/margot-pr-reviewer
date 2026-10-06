# margot-runtime: the container every card and voice `claude` invocation runs in,
# ported from the previous reviewer's image. The package runs one `docker run` per
# invocation with a read-only root, no capabilities, and only two read-only mounts:
# the base-sha checkout at /work and the card bundle at /opt/margot/bundle. The
# bundle is mounted, never baked, so the image does not change when the bundle pin
# does.
#
# Credentials: none baked. CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY), GH_TOKEN
# (a read-scoped token) and MARGOT_MCP_CONFIG (the ticketing MCP config, which holds
# its token) are passed by name at `docker run` time.
#
# Build from the installed release package root (or a checkout after `npm run build`):
# docker build -f runtime/Dockerfile .
# runtime/Dockerfile.dockerignore keeps the context to the two files the build reads.
# Pin the base by digest at build time (--build-arg BASE_IMAGE=node:22-bookworm@sha256:...).
# CLAUDE_CODE_VERSION must equal the configuration's claude.version: the package does
# not check the version at run time, so this build and the image digest pin it.
ARG BASE_IMAGE=node:22-bookworm
FROM ${BASE_IMAGE}

ARG CLAUDE_CODE_VERSION
ARG MCP_LINEAR_VERSION

RUN test -n "$CLAUDE_CODE_VERSION" || { echo "CLAUDE_CODE_VERSION build arg required (pin it)" >&2; exit 1; }
RUN test -n "$MCP_LINEAR_VERSION" || { echo "MCP_LINEAR_VERSION build arg required (pin it)" >&2; exit 1; }

USER root

# gh (the reviewers read the PR head with it), git, jq, ripgrep, ca-certificates, curl.
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    # A runner host may permit only HTTPS egress; Debian's stock mirror is HTTP.
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    apt-get update -qq; \
    apt-get install -y --no-install-recommends ca-certificates curl git jq ripgrep gnupg; \
    mkdir -p -m 755 /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update -qq; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*; \
    gh --version; git --version; jq --version; rg --version

# Claude Code and the Linear MCP server, pinned.
RUN npm install -g \
        @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
        @tacticlaunch/mcp-linear@${MCP_LINEAR_VERSION} \
    && npm cache clean --force \
    && claude --version | grep -q "^${CLAUDE_CODE_VERSION} " \
    && command -v mcp-linear

# Flag-drift guard: every long flag the package passes to `claude` must exist in this
# Claude Code's --help, so a removed flag fails the build rather than a live review.
RUN --mount=type=bind,source=dist/adapters/claude.js,target=/tmp/claude.js \
    set -eux; \
    help="$(claude --help 2>&1)"; \
    flags="$(grep -oE '"--[a-zA-Z-]+"' /tmp/claude.js | tr -d '"' | sort -u)"; \
    test -n "$flags" || { echo "flag guard found no claude flags" >&2; exit 1; }; \
    for f in $flags; do \
      printf '%s\n' "$help" | grep -qF -- "$f" || { echo "claude flag '$f' is absent from 'claude --help' ($(claude --version))" >&2; exit 1; }; \
    done; \
    echo "all claude flags present in claude --help"

COPY --chown=root:root runtime/entrypoint.sh /usr/local/bin/margot-entrypoint
RUN chmod 755 /usr/local/bin/margot-entrypoint

# node:22 ships the non-root `node` user (uid 1000).
USER node
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/margot-entrypoint"]
