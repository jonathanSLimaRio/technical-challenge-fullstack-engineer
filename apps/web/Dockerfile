FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY .npmrc ./
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm install --legacy-peer-deps

COPY apps/web ./
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
