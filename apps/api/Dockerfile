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
RUN mkdir -p /app/storage/chat && chown -R node:node /app/storage
USER node
# Verify native/WebAssembly fallback on the deployment CPU before replacing the API.
RUN node -e "require('sharp')({create:{width:1,height:1,channels:3,background:'#ffffff'}}).webp().toBuffer().then(() => console.log('Image runtime ready')).catch(e => { console.error(e); process.exit(1); })"
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
