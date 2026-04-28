# Stdio MCP server for Cursor — run with: docker run -i --rm … (see README)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Reach the API on the host from inside the container (Docker Desktop provides host.docker.internal)
ENV SURVEYS_API_BASE_URL=http://host.docker.internal:8080

RUN addgroup -g 1001 -S nodeapp && adduser -u 1001 -S -G nodeapp nodeapp

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER nodeapp

ENTRYPOINT ["node", "dist/index.js"]
