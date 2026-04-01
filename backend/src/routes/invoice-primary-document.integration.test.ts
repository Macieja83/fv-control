import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

describe("GET /invoices/:id/primary-document", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginToken(): Promise<string> {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@fvresta.local", password: "Admin123!" },
    });
    expect(login.statusCode).toBe(200);
    return (JSON.parse(login.body) as { accessToken: string }).accessToken;
  }

  it("returns 400 when id is not a UUID", async () => {
    const token = await loginToken();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/invoices/not-a-uuid/primary-document",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when invoice has no primary document (seed DEMO-GMAIL-001)", async () => {
    const token = await loginToken();
    const id = "00000000-0000-4000-8000-000000000020";
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${id}/primary-document`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
