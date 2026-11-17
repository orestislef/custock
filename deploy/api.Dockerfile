# the custock api. build from the repo root:
#   docker build -f deploy/api.Dockerfile -t custock-api .
# runs as the unprivileged node user, keeps the database and uploads in the /data volume.

FROM node:22-slim AS deps
WORKDIR /app
# better-sqlite3 uses a prebuilt binary, the toolchain is only a fallback
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
# every manifest of the workspace, so the lockfile matches, then only the api's dependency graph
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/tokens/package.json packages/tokens/
RUN pnpm install --frozen-lockfile --filter "@custock/api..."

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8787 \
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
# backup tools, run with docker compose exec api node scripts/db-snapshot.mjs ...
COPY scripts/db-snapshot.mjs scripts/db-restore-check.mjs scripts/
# photo urls for the made up demo data (only read with CUSTOCK_SEED=1)
COPY demo/assets/js/images.js demo/assets/js/images.js
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
