import pg from "pg";
import { type AppConfig, isMetricsDbConfigured } from "../config/env.js";

export type MetricsPool = pg.Pool;

export function createMetricsPool(config: AppConfig): MetricsPool | null {
  if (!isMetricsDbConfigured(config)) {
    return null;
  }
  return new pg.Pool({
    host: config.metricsDbHost,
    port: config.metricsDbPort,
    user: config.metricsDbUser,
    password: config.metricsDbPassword,
    database: config.metricsDbName,
    max: config.databasePoolMax,
    ssl: { rejectUnauthorized: false },
  });
}
