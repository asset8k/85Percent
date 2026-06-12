# Dockerfile for the Fastify API (apps/api), built from the monorepo root so the
# pnpm workspace and the shared packages/* the API depends on are all in context.
#
# We install pnpm 11 DIRECTLY via npm rather than through corepack: Railway's
# Nixpacks pins corepack@0.24.1, which cannot load pnpm 11.2.2 and crashes with
# ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING. Installing pnpm straight from npm
# sidesteps corepack entirely.
#
# Single stage, full workspace install: this is the exact known-good path the
# repo uses locally. NODE_ENV is left unset during install/build so pnpm keeps
# devDependencies (typescript, turbo) needed to compile, then set to production
# only for the runtime CMD.

# Node 22, not 20: pnpm 11.2.2 imports node:sqlite, a built-in only present from
# Node 22.5+ (on Node 20 pnpm crashes with ERR_UNKNOWN_BUILTIN_MODULE). The app
# itself only needs Node >=20, so 22 satisfies both.
FROM node:22-bookworm-slim

# pnpm + the system libs prisma/sharp need (openssl, a C toolchain for any
# native postinstalls).
RUN npm install -g pnpm@11.2.2 \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first so the install layer caches across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/landing-page/package.json apps/landing-page/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/brand/package.json packages/brand/package.json

RUN pnpm install --frozen-lockfile

# Source, then build the API (turbo builds its workspace deps first via ^build).
COPY . .
RUN pnpm turbo run build --filter=@85percent/api

ENV NODE_ENV=production
# The server reads PORT from the environment (Railway injects it) and binds 0.0.0.0.
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
