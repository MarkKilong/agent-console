# Build from the repository root:
#   docker build -f packages/runner/Dockerfile -t agent-console-runner .
# Run with the workspace mounted at /workspace:
#   docker run -e RUNNER_TOKEN=... -p 4310:4310 -v "$PWD:/workspace" agent-console-runner
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Native installer, not the npm shim: the SDK spawns the binary without a shell. The config
# dir is fixed before the first run so the config the installer writes is the one the runner
# finds at runtime; with it elsewhere, Claude sees only its own backup and refuses to answer.
ENV CLAUDE_CONFIG_DIR="/root/.claude"
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:${PATH}"
ENV CLAUDE_BINARY="/root/.local/bin/claude"
# First invocation creates .claude.json; every later one then answers with JSON straight away.
RUN claude auth status --json < /dev/null > /dev/null 2>&1 || true
RUN test -f /root/.claude/.claude.json

# node-pty (the terminal) ships prebuilt bindings for win32 and darwin only, so on this
# image its install script falls through to `node-gyp rebuild`; python3/make/g++ above are for it.
RUN corepack enable

WORKDIR /app

# Manifests first so dependency installation caches independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/runner/package.json ./packages/runner/
RUN pnpm install --frozen-lockfile --filter "@agent-console/runner..."

COPY packages/contracts ./packages/contracts
COPY packages/runner ./packages/runner
RUN pnpm --filter "@agent-console/runner..." build

# The mounted repo is usually owned by a different uid than root.
RUN git config --global --add safe.directory /workspace

ENV RUNNER_PORT=4310
ENV RUNNER_CWD=/workspace
EXPOSE 4310

WORKDIR /app/packages/runner
CMD ["node", "dist/main.js"]
