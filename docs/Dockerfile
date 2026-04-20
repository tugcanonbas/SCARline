FROM node:22-alpine AS build

WORKDIR /workspace

RUN apk add --no-cache git
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY docs ./docs

RUN pnpm install --filter @scarline/docs... --frozen-lockfile=false
RUN pnpm --dir /workspace/docs build

FROM caddy:2

COPY --from=build /workspace/docs/.vitepress/dist /srv

EXPOSE 4040

CMD ["caddy", "file-server", "--browse", "--listen", ":4040", "--root", "/srv"]