FROM node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/sim-bridge ./services/sim-bridge

RUN pnpm install --filter @scarline/sim-bridge... --frozen-lockfile=false
RUN pnpm --dir /workspace/packages/contracts build
RUN pnpm --dir /workspace/services/sim-bridge build

WORKDIR /workspace/services/sim-bridge
CMD ["node", "dist/index.js"]
