FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY .npmrc ./
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm install --legacy-peer-deps

COPY apps/api ./
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY .npmrc ./
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=builder /app/dist dist

EXPOSE 3001

CMD ["node", "dist/main.js"]
