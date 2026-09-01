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
COPY apps/admin-panel apps/admin-panel

RUN npm run build -w @scarline/contracts -w @scarline/admin-panel
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/admin-panel/build ./build
COPY --from=build --chown=node:node /app/apps/admin-panel/package.json ./package.json
COPY --chown=node:node widgets ./widgets

USER node

EXPOSE 5173

CMD ["node", "build"]
