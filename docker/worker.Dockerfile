FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@9.15.0

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY platform ./platform
COPY core ./core
COPY kit ./kit
COPY apps/worker ./apps/worker
COPY modules ./modules

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @cs/worker... build || true

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./

CMD ["node", "apps/worker/dist/main.js"]
