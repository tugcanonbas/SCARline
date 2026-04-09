FROM node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-panel ./apps/admin-panel

RUN pnpm install --filter @scarline/admin-panel... --frozen-lockfile=false
RUN pnpm --dir /workspace/apps/admin-panel build

WORKDIR /workspace/apps/admin-panel
CMD ["node", "build"]
