FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production=false
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
