# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY services/core-api/package.json services/core-api/package.json
COPY services/sim-bridge/package.json services/sim-bridge/package.json
COPY services/mock-simulator/package.json services/mock-simulator/package.json
COPY apps/admin-panel/package.json apps/admin-panel/package.json
COPY apps/overlay-web/package.json apps/overlay-web/package.json
COPY apps/desktop-overlay/package.json apps/desktop-overlay/package.json

RUN npm ci --ignore-scripts

COPY packages/contracts packages/contracts
COPY services/sim-bridge services/sim-bridge

RUN npm run build -w @scarline/contracts -w @scarline/sim-bridge
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/services/sim-bridge/package.json ./services/sim-bridge/package.json
COPY --from=build --chown=node:node /app/services/sim-bridge/dist ./services/sim-bridge/dist
COPY --chown=node:node package.json config.yml ./

USER node

EXPOSE 9000

CMD ["node", "services/sim-bridge/dist/server.js"]
