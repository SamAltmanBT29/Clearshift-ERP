FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@9.15.0

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY ui ./ui
COPY apps/web ./apps/web
COPY modules ./modules

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @cs/web... build || true

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html || true
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
