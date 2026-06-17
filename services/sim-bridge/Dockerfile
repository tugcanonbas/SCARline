FROM node:22-alpine

WORKDIR /workspace

ENV PATH /usr/local/bin:$PATH
RUN /usr/local/bin/npm install -g pnpm@latest

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/sim-bridge ./services/sim-bridge

RUN pnpm install --filter @scarline/sim-bridge... --frozen-lockfile=false
RUN pnpm --dir /workspace/packages/contracts build
RUN pnpm --dir /workspace/services/sim-bridge build

WORKDIR /workspace/services/sim-bridge
CMD ["node", "dist/index.js"]
