import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

describe("idempotency concurrency", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("parallel identical POSTs share one invoice id (no double create)", async () => {
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

    const idemKey = `idem-conc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const num = `CONC-${Date.now()}`;
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
    const batch = await Promise.all(
      Array.from({ length: 12 }, () =>
        app.inject({
          method: "POST",
          url: "/api/v1/invoices",
          headers,
          payload: body,
        }),
      ),
    );

    const ok = batch.filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(
      batch
        .filter((r) => r.statusCode === 201)
        .map((r) => (JSON.parse(r.body) as { id: string }).id),
    );
    expect(ids.size).toBe(1);
  });
});
