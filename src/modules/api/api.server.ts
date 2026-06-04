import http from "node:http";
import { config } from "../../config/env";
import { connectDatabase, disconnectDatabase } from "../../database/client";
import { LoggerService } from "../logger/logger.service";
import { ApiRoute } from "./api.types";
import { parseRequestUrl, sendJson, sendOptions } from "./api.utils";
import { healthRoutes } from "./routes/health.routes";
import { learningRoutes } from "./routes/learning.routes";
import { logsRoutes } from "./routes/logs.routes";
import { marketsRoutes } from "./routes/markets.routes";
import { performanceRoutes } from "./routes/performance.routes";
import { predictionsRoutes } from "./routes/predictions.routes";
import { tradesRoutes } from "./routes/trades.routes";

const API_PORT = Number(process.env.API_PORT ?? 3001);
const logger = new LoggerService(config.logLevel);

const routes: ApiRoute[] = [
  ...healthRoutes,
  ...logsRoutes,
  ...performanceRoutes,
  ...marketsRoutes,
  ...predictionsRoutes,
  ...tradesRoutes,
  ...learningRoutes
];

const routeMap = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      sendOptions(res);
      return;
    }

    const url = parseRequestUrl(req);
    const route = routeMap.get(`${req.method} ${url.pathname}`);

    if (!route) {
      sendJson(res, 404, { error: "Route not found." });
      return;
    }

    try {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = await route.handler({ req, res, url, query });
      sendJson(res, 200, payload);
    } catch (error) {
      logger.error("Local API route failed.", error, {
        method: req.method,
        path: url.pathname
      });
      sendJson(res, 500, { error: "Local API route failed." });
    }
  });

  server.listen(API_PORT, "127.0.0.1", () => {
    logger.info(`Local monitor API listening on http://127.0.0.1:${API_PORT}`);
  });

  async function shutdown(reason: string): Promise<void> {
    logger.info(`Shutting down local monitor API: ${reason}`);
    server.close();
    await disconnectDatabase();
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });
}

bootstrap().catch(async (error: unknown) => {
  logger.error("Local monitor API failed to start.", error);
  await disconnectDatabase();
  process.exitCode = 1;
});
