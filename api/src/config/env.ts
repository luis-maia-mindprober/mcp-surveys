export type AppConfig = {
  mcpApiKey: string;
  port: number;
  host: string;
  nodeEnv: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  databasePoolMax: number;
  /** Optional second DB (e.g. metrics) for session inspect / testers_session_information. */
  metricsDbHost: string;
  metricsDbPort: number;
  metricsDbUser: string;
  metricsDbPassword: string;
  metricsDbName: string;
};

function numOr(defaultVal: number, raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultVal;
}

/** True when host, user, and database name are set (required to open a pool). */
export function isRawDataDbConfigured(config: AppConfig): boolean {
  return (
    config.dbHost.trim().length > 0 &&
    config.dbUser.trim().length > 0 &&
    config.dbName.trim().length > 0
  );
}

/** Optional metrics database (same engine as raw_data; separate database name). */
export function isMetricsDbConfigured(config: AppConfig): boolean {
  return (
    config.metricsDbHost.trim().length > 0 &&
    config.metricsDbUser.trim().length > 0 &&
    config.metricsDbName.trim().length > 0
  );
}

export function loadConfig(): AppConfig {
  return {
    mcpApiKey: (process.env.MCP_API_KEY ?? "").trim(),
    port: Number(process.env.API_PORT ?? "8080"),
    host: process.env.API_HOST ?? "0.0.0.0",
    nodeEnv: (process.env.NODE_ENV ?? "").trim(),
    dbHost: (process.env.DB_HOST ?? "").trim(),
    dbPort: numOr(5432, process.env.DB_PORT),
    dbUser: (process.env.DB_USER ?? "").trim(),
    dbPassword: process.env.DB_PASSWORD ?? "",
    dbName: (process.env.DB_NAME ?? "").trim(),
    databasePoolMax: numOr(10, process.env.DATABASE_POOL_MAX),
    metricsDbHost: (process.env.METRICS_DB_HOST ?? "").trim(),
    metricsDbPort: numOr(5432, process.env.METRICS_DB_PORT),
    metricsDbUser: (process.env.METRICS_DB_USER ?? "").trim(),
    metricsDbPassword: process.env.METRICS_DB_PASSWORD ?? "",
    metricsDbName: (process.env.METRICS_DB_NAME ?? "").trim(),
  };
}
