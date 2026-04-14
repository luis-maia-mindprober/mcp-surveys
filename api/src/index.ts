import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
import { isRawDataDbConfigured, loadConfig } from "./config/env.js";
import { createMetricsPool } from "./db/metrics-pg.js";
import { createRawDataPool } from "./db/raw-data-pg.js";
import { registerRoutes } from "./routes/index.js";

const config = loadConfig();
const rawDataPool = createRawDataPool(config);
const metricsPool = createMetricsPool(config);

const app = Fastify({ logger: true });

if (!config.mcpApiKey) {
  app.addHook("onReady", async () => {
    app.log.warn(
      "MCP_API_KEY is not set — API is open. Set MCP_API_KEY before exposing this service.",
    );
  });
}

if (!isRawDataDbConfigured(config)) {
  app.addHook("onReady", async () => {
    app.log.warn(
      "Database not configured — set DB_HOST, DB_USER, DB_NAME (and DB_PASSWORD, DB_PORT if needed). GET /v1/surveys will return 503 until configured.",
    );
  });
}

registerRoutes(app, { config, rawDataPool, metricsPool });

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
