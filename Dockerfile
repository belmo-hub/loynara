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
RUN apt-get update && apt-get install -y --no-install-recommends openssl zip && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=build /app /app
USER node
CMD ["sh", "-c", "npm start -- --hostname 0.0.0.0 --port ${PORT:-3000}"]
