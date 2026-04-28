FROM node:22-alpine AS api-builder
WORKDIR /build/api

COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-alpine AS mcp-builder
WORKDIR /build/surveys-mcp

COPY surveys-mcp/package.json surveys-mcp/package-lock.json ./
RUN npm ci

COPY surveys-mcp/tsconfig.json ./
COPY surveys-mcp/src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8080
ENV SURVEYS_API_BASE_URL=http://127.0.0.1:8080

RUN addgroup -g 1001 -S nodeapp && adduser -u 1001 -S -G nodeapp nodeapp

WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=api-builder /build/api/dist ./dist

WORKDIR /app/surveys-mcp
COPY surveys-mcp/package.json surveys-mcp/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=mcp-builder /build/surveys-mcp/dist ./dist

WORKDIR /app
COPY run-api-and-mcp.sh /usr/local/bin/run-api-and-mcp.sh
RUN chmod +x /usr/local/bin/run-api-and-mcp.sh

USER nodeapp
EXPOSE 8080

ENTRYPOINT ["run-api-and-mcp.sh"]
