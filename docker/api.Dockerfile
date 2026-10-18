FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@9.15.0

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY platform ./platform
COPY core ./core
COPY kit ./kit
COPY ui ./ui
COPY apps/api ./apps/api
COPY modules ./modules

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @cs/api... build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@9.15.0

COPY --from=builder /app ./

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
