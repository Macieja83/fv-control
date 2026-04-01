import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("app", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/version returns JSON", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/version" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { name: string; version: string };
    expect(body.name).toBeTruthy();
    expect(body.version).toBeTruthy();
  });
});
