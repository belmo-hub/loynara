FROM node:26-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Apple Wallet passes are signed with `openssl cms` and packed with `zip` (src/lib/wallet/apple.ts). The slim base image
# ships neither; without them Apple Wallet reports unavailable. Verify with: npx tsx scripts/wallet-runtime-check.ts
# Closure instructions are encrypted and acknowledged offsite before closure commits.
# The retention job also uses the PostgreSQL client; private decryption keys are never installed here.
RUN apt-get update && apt-get install -y --no-install-recommends openssl zip python3 age awscli postgresql-client && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=build /app /app
USER node
CMD ["sh", "-c", "npm start -- --hostname 0.0.0.0 --port ${PORT:-3000}"]
