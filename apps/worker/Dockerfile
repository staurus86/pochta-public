FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    tesseract-ocr tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN npm install --workspace=apps/worker --include-workspace-root

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker
COPY package.json ./
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma
EXPOSE 4001
CMD ["node", "--loader", "ts-node/esm", "apps/worker/src/index.ts"]
