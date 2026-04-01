import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    const id = (request.headers["x-request-id"] as string | undefined)?.trim() || randomUUID();
    request.requestId = id;
    reply.header("x-request-id", id);
  });

  app.addHook("onResponse", async (request, reply) => {
    const redacted = redactHeaders(request.headers);
    request.log.info(
      {
        reqId: request.requestId,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime,
        headers: redacted,
      },
      "request completed",
    );
  });
};

const SENSITIVE = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-fvcontrol-signature",
  "x-signature",
]);

function redactHeaders(h: Record<string, unknown>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    if (SENSITIVE.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v as string | string[] | undefined;
    }
  }
  return out;
}

export default fp(requestContextPlugin, { name: "request-context" });
