import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

describe("idempotency POST /invoices", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("replays identical POST with same Idempotency-Key and rejects payload mismatch", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@fvresta.local", password: "Admin123!" },
    });
    expect(login.statusCode).toBe(200);
    const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;

    const contractors = await app.inject({
      method: "GET",
      url: "/api/v1/contractors",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(contractors.statusCode).toBe(200);
    const list = JSON.parse(contractors.body) as Array<{ id: string }>;
    const cid = list[0]?.id;
    expect(cid).toBeTruthy();

    const idemKey = `idem-inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const num = `IDEM-${Date.now()}`;
    const body = {
      contractorId: cid,
      number: num,
      issueDate: "2026-04-01",
      currency: "PLN",
      status: "DRAFT",
      items: [
        {
          name: "Line",
          quantity: "1",
          netPrice: "10.00",
          vatRate: "23.00",
          netValue: "10.00",
          grossValue: "12.30",
        },
      ],
    };

    const headers = { authorization: `Bearer ${token}`, "idempotency-key": idemKey };
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers,
      payload: body,
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers,
      payload: body,
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    const j1 = JSON.parse(r1.body) as { id: string };
    const j2 = JSON.parse(r2.body) as { id: string };
    expect(j1.id).toBe(j2.id);

    const r3 = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers,
      payload: { ...body, number: `OTHER-${Date.now()}` },
    });
    expect(r3.statusCode).toBe(409);
  });
});
