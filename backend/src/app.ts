import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { loadConfig, getCorsOriginList } from "./config.js";
import authPlugin from "./plugins/auth.js";
import errorHandlerPlugin from "./plugins/error-handler.js";
import prismaPlugin from "./plugins/prisma.js";
import requestContextPlugin from "./plugins/request-context.js";
import swaggerPlugin from "./plugins/swagger.js";
import { registerApiRoutes } from "./routes/index.js";

export async function buildApp() {
  const cfg = loadConfig();

  const app = Fastify({
    disableRequestLogging: true,
    logger: {
      level: cfg.LOG_LEVEL,
      ...(cfg.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
            },
          }
        : {}),
    },
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = getCorsOriginList();
      if (!origin) {
        cb(null, true);
        return;
      }
      if (allowed.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });

  await app.register(requestContextPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(swaggerPlugin);
  await app.register(rateLimit, { global: false });

  await app.register(
    async (api) => {
      await api.register(multipart, {
        limits: {
          fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024,
          files: 1,
        },
      });
      await registerApiRoutes(api);
    },
    { prefix: "/api" },
  );

  return app;
}
