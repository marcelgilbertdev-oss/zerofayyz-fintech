# Multi-stage, because the image that ships should not contain the toolchain
# that built it: fewer packages in the runtime image is fewer things to patch.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, on their own layer. Copying source before installing
# means every source edit re-downloads the dependency tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Re-resolve with production dependencies only, so devDependencies (tsx,
# typescript, the test tooling) never reach the runtime image.
RUN npm ci --omit=dev


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Bind to all interfaces: a container that binds to loopback is unreachable
# from outside itself, which passes every local check and fails every real one.
ENV HOST=0.0.0.0
ENV PORT=4000

# Run as a non-root user. The node image ships one; using it means a container
# escape does not begin with root in the namespace.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 4000

# Readiness, not liveness: the orchestrator should withhold traffic from an
# instance that cannot reach the ledger, and /health deliberately answers 200
# while degraded. See ADR-aligned reasoning in health.routes.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
