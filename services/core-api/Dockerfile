FROM node:22-alpine

WORKDIR /workspace

ENV PATH /usr/local/bin:$PATH
RUN /usr/local/bin/npm install -g pnpm@latest

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/core-api ./services/core-api
COPY widgets ./widgets

RUN pnpm install --filter @scarline/core-api... --frozen-lockfile=false
RUN pnpm --dir /workspace/packages/contracts build
RUN pnpm --dir /workspace/services/core-api build

WORKDIR /workspace/services/core-api
CMD ["node", "dist/index.js"]
