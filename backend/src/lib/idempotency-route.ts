import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { stableStringify } from "./stable-json.js";

export function buildIdempotencyRouteKey(request: FastifyRequest): string {
  const pattern =
    request.routeOptions?.url ??
    (request as { routerPath?: string }).routerPath ??
    request.url.split("?")[0] ??
    request.url;
  const params = request.params && typeof request.params === "object" ? request.params : {};
  return `${request.method} ${pattern}|${stableStringify(params)}`;
}

export function hashIdempotencyPayload(method: string, routeKey: string, body: unknown): string {
  const bodyPart = body === undefined ? "" : stableStringify(body);
  const raw = `${method}\n${routeKey}\n${bodyPart}`;
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
