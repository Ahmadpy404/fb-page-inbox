# Multi-stage Dockerfile for FB Page Unified Inbox

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy root and workspace package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm install

# Copy source code and prisma schema
COPY server ./server
COPY client ./client

# Generate Prisma Client & Build Server
WORKDIR /app/server
RUN npx prisma generate
RUN npm run build

# Build Client
WORKDIR /app/client
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm install --omit=dev --workspace=server

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/server/node_modules/.prisma ./server/node_modules/.prisma
COPY --from=builder /app/server/node_modules/@prisma ./server/node_modules/@prisma
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "dist/server.js"]
