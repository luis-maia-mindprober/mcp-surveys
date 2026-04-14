import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import type { MetricsPool } from "../db/metrics-pg.js";
import type { RawDataPool } from "../db/raw-data-pg.js";
import { registerDataQualityRoutes } from "./data-quality.js";
import { registerHealthRoutes } from "./health.js";
import { registerSessionAnswerFrequencyRoutes } from "./session-answer-frequency.js";
import { registerSessionBrandFitReportRoutes } from "./session-brand-fit-report.js";
import { registerSessionBrandRecallRoutes } from "./session-brand-recall.js";
import { registerSessionInsightsRoutes } from "./session-insights.js";
import { registerSessionInspectRoutes } from "./session-inspect.js";
import { registerSessionOpenTextFrequencyRoutes } from "./session-open-text-frequency.js";
import { registerSessionQuestionFrequencyRoutes } from "./session-question-frequency.js";
import { registerSessionQuestionsRoutes } from "./session-questions.js";
import { registerSurveysRoutes } from "./surveys.js";

export type RouteDeps = {
  config: AppConfig;
  rawDataPool: RawDataPool | null;
  metricsPool: MetricsPool | null;
};

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerHealthRoutes(app);
  registerSurveysRoutes(app, deps.config, deps.rawDataPool);
  registerSessionInsightsRoutes(app, deps.config, deps.rawDataPool);
  registerSessionQuestionsRoutes(app, deps.config, deps.rawDataPool);
  registerSessionBrandFitReportRoutes(app, deps.config, deps.rawDataPool);
  registerSessionOpenTextFrequencyRoutes(app, deps.config, deps.rawDataPool);
  registerSessionAnswerFrequencyRoutes(app, deps.config, deps.rawDataPool);
  registerSessionQuestionFrequencyRoutes(app, deps.config, deps.rawDataPool);
  registerSessionBrandRecallRoutes(app, deps.config, deps.rawDataPool);
  registerSessionInspectRoutes(app, deps.config, deps.rawDataPool, deps.metricsPool);
  registerDataQualityRoutes(app, deps.config, deps.rawDataPool);
}
