import pg from "pg";
import { type AppConfig, isRawDataDbConfigured } from "../config/env.js";

export type RawDataPool = pg.Pool;

export function createRawDataPool(config: AppConfig): RawDataPool | null {
  if (!isRawDataDbConfigured(config)) {
    return null;
  }
  return new pg.Pool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    max: config.databasePoolMax,
    ssl: { rejectUnauthorized: false },
  });
}
