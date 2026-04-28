FROM node:22-alpine

WORKDIR /workspace

ENV PATH /usr/local/bin:$PATH
RUN /usr/local/bin/npm install -g pnpm@latest

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/overlay-web ./apps/overlay-web
COPY widgets ./widgets

RUN pnpm install --filter @scarline/overlay-web... --frozen-lockfile=false
RUN pnpm --dir /workspace/apps/overlay-web build

WORKDIR /workspace/apps/overlay-web
CMD ["node", "dist/server.js"]
