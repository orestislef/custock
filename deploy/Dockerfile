# custock in one image: the api and the web in one container, started by deploy/start.mjs.
# build from the repo root:
#   docker build -f deploy/Dockerfile --build-arg CUSTOCK_BASE_PATH=/custock -t custock .
# the web listens on 3000, the api on 8787. the reverse proxy sends <base>/api/* to the api and
# everything else under <base> to the web.

FROM node:22-slim AS base
WORKDIR /app
# better-sqlite3 uses a prebuilt binary, the toolchain is only a fallback
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

# the api's production dependencies only. the workspace is cut down to the api and the shared
# packages first, otherwise the hoisted install brings the whole web and phone toolchains along
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/tokens/package.json packages/tokens/
RUN echo "packages: [apps/api, 'packages/*']" > pnpm-workspace.yaml \
 && echo "onlyBuiltDependencies: [better-sqlite3, esbuild]" >> pnpm-workspace.yaml \
 && pnpm install --prod --no-frozen-lockfile

# the web as a next.js standalone server
FROM base AS web
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/tokens/package.json packages/tokens/
RUN pnpm install --frozen-lockfile --filter "@custock/web..."
COPY packages packages
COPY apps/web apps/web
# the base path and the api address are fixed at build time
ARG CUSTOCK_BASE_PATH=
ENV CUSTOCK_BASE_PATH=$CUSTOCK_BASE_PATH CUSTOCK_API_URL=http://127.0.0.1:8787 NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p apps/web/public && NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @custock/web build

FROM node:22-slim
ARG CUSTOCK_BASE_PATH=
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CUSTOCK_BASE_PATH=$CUSTOCK_BASE_PATH \
    CUSTOCK_DB=/data/custock.db \
    CUSTOCK_UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app /app
COPY packages/core/src packages/core/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/i18n/src packages/i18n/src
COPY packages/tokens/src packages/tokens/src
COPY apps/api/src apps/api/src
COPY scripts/db-snapshot.mjs scripts/db-restore-check.mjs scripts/
# photo urls for the made up demo data (only read with CUSTOCK_SEED=1)
COPY demo/assets/js/images.js demo/assets/js/images.js
COPY --from=web /app/apps/web/.next/standalone /app/web
COPY --from=web /app/apps/web/.next/static /app/web/apps/web/.next/static
COPY --from=web /app/apps/web/public /app/web/apps/web/public
COPY deploy/start.mjs deploy/start.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:8787/health'),fetch('http://127.0.0.1:3000'+(process.env.CUSTOCK_BASE_PATH||'/'))]).then(r=>process.exit(r.every(x=>x.ok)?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/start.mjs"]
