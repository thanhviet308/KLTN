FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=@chat/api --include-workspace-root=false --no-audit --no-fund
COPY apps/api/tsconfig*.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build --workspace=@chat/api

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace=@chat/api --include-workspace-root=false --no-audit --no-fund \
    && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
