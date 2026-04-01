import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

describe("invoice compliance list filters", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /invoices?reviewStatus=NEEDS_REVIEW includes OCR demo row from seed", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@fvresta.local", password: "Admin123!" },
    });
    expect(login.statusCode).toBe(200);
    const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/invoices?reviewStatus=NEEDS_REVIEW&limit=50",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: Array<{ number: string }> };
    expect(body.data.some((row) => row.number === "DEMO-SCAN-001")).toBe(true);
  });
});
