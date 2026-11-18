# the custock web (customer pages and /admin) as a Next.js standalone server. build from the repo root:
#   docker build -f deploy/web.Dockerfile --build-arg CUSTOCK_API_URL=http://api:8787 -t custock-web .
# needs output: "standalone" in apps/web/next.config.ts (see deploy/README.md).

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/tokens/package.json packages/tokens/
RUN pnpm install --frozen-lockfile --filter "@custock/web..."
COPY packages packages
COPY apps/web apps/web
# rewrites are fixed at build time, so the api address is a build argument
ARG CUSTOCK_API_URL=http://api:8787
ENV CUSTOCK_API_URL=$CUSTOCK_API_URL NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p apps/web/public && pnpm --filter @custock/web build

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
