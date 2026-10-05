FROM oven/bun:1.4.2-slim AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/mcp/package.json packages/mcp/package.json
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-slim

WORKDIR /app
COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
# Bun links each workspace package's dependencies (including the other workspace packages) in
# that package's own node_modules.
COPY --from=dependencies --chown=bun:bun /app/packages/core/node_modules packages/core/node_modules
COPY --from=dependencies --chown=bun:bun /app/packages/api/node_modules packages/api/node_modules
COPY --from=dependencies --chown=bun:bun /app/packages/mcp/node_modules packages/mcp/node_modules
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun packages/core/package.json packages/core/package.json
COPY --chown=bun:bun packages/api/package.json packages/api/package.json
COPY --chown=bun:bun packages/mcp/package.json packages/mcp/package.json
COPY --chown=bun:bun packages/core/src packages/core/src
COPY --chown=bun:bun packages/core/drizzle packages/core/drizzle
COPY --chown=bun:bun packages/api/src packages/api/src
COPY --chown=bun:bun packages/mcp/src packages/mcp/src
RUN mkdir /data && chown bun:bun /data

USER bun
EXPOSE 3000
CMD ["bun", "packages/api/src/server.ts"]
