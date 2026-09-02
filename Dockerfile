FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
RUN export DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
	BETTER_AUTH_URL="http://localhost:3000" \
	BETTER_AUTH_SECRET="docker-build-only-secret-not-used-at-runtime" && \
	pnpm db:generate && pnpm build

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

FROM dependencies AS worker
COPY . .
RUN pnpm db:generate
CMD ["pnpm", "worker"]