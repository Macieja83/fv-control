/**
 * Minimal smoke test przed release:
 * register tenant -> verify email -> login -> auth/me -> tenant profile.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:3000 npx tsx scripts/smoke-tenant-journey.ts
 *
 * Optional full KSeF self-service gate:
 *   SMOKE_REQUIRE_KSEF=1 \
 *   SMOKE_KSEF_TOKEN=... \
 *   SMOKE_KSEF_PIN=... \
 *   SMOKE_KSEF_ENV=sandbox \
 *   npx tsx scripts/smoke-tenant-journey.ts
 */

type Json = Record<string, unknown>;

function readBaseUrl(): string {
  const raw = process.env.SMOKE_BASE_URL?.trim() || "http://localhost:3000";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function makeTenantSeed() {
  const seed = Date.now().toString(36);
  const name = `Smoke Tenant ${seed}`;
  const email = `smoke.${seed}@example.test`;
  const nip = `91${Date.now().toString().slice(-8)}`;
  return { name, email, nip, password: "SmokePass123!" };
}

async function readJsonSafe(res: Response): Promise<Json> {
  try {
    return (await res.json()) as Json;
  } catch {
    return {};
  }
}

function errMsg(body: Json, fallback: string): string {
  const e = body.error;
  if (typeof e === "string" && e.trim()) return e.trim();
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    return ((e as { message: string }).message || "").trim() || fallback;
  }
  return fallback;
}

async function apiJson(base: string, path: string, init: RequestInit = {}): Promise<{ res: Response; body: Json }> {
  const res = await fetch(`${base}${path}`, init);
  return { res, body: await readJsonSafe(res) };
}

function authHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}

async function main() {
  const base = readBaseUrl();
  const seed = makeTenantSeed();
  const started = new Date().toISOString();
  const out: { step: string; ok: boolean; note: string }[] = [];

  console.log(`[smoke] start ${started} base=${base}`);
  console.log(`[smoke] tenant=${seed.name} email=${seed.email}`);

  const registerRes = await fetch(`${base}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantName: seed.name,
      tenantNip: null,
      email: seed.email,
      password: seed.password,
      planCode: "free",
    }),
  });
  const registerBody = await readJsonSafe(registerRes);
  if (!registerRes.ok) {
    const msg = errMsg(registerBody, `register failed (${registerRes.status})`);
    out.push({ step: "register", ok: false, note: msg });
    throw new Error(msg);
  }
  out.push({ step: "register", ok: true, note: "tenant created" });

  const verificationToken =
    typeof registerBody.verificationToken === "string" ? registerBody.verificationToken.trim() : "";
  if (!verificationToken) {
    const msg =
      "Missing verificationToken in response. Use non-production/staging mode exposing token or adapt script to read mailbox.";
    out.push({ step: "verify-token", ok: false, note: msg });
    throw new Error(msg);
  }
  out.push({ step: "verify-token", ok: true, note: "token present" });

  const verifyRes = await fetch(`${base}/api/v1/auth/verify-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: verificationToken }),
  });
  const verifyBody = await readJsonSafe(verifyRes);
  if (!verifyRes.ok) {
    const msg = errMsg(verifyBody, `verify-email failed (${verifyRes.status})`);
    out.push({ step: "verify-email", ok: false, note: msg });
    throw new Error(msg);
  }
  out.push({ step: "verify-email", ok: true, note: "email verified" });

  const loginRes = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: seed.email, password: seed.password }),
  });
  const loginBody = await readJsonSafe(loginRes);
  if (!loginRes.ok) {
    const msg = errMsg(loginBody, `login failed (${loginRes.status})`);
    out.push({ step: "login", ok: false, note: msg });
    throw new Error(msg);
  }
  const accessToken =
    typeof loginBody.accessToken === "string" ? loginBody.accessToken.trim() : "";
  if (!accessToken) {
    const msg = "Missing accessToken in login response";
    out.push({ step: "login-token", ok: false, note: msg });
    throw new Error(msg);
  }
  out.push({ step: "login", ok: true, note: "token received" });

  const meRes = await fetch(`${base}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const meBody = await readJsonSafe(meRes);
  if (!meRes.ok) {
    const msg = errMsg(meBody, `auth/me failed (${meRes.status})`);
    out.push({ step: "auth-me", ok: false, note: msg });
    throw new Error(msg);
  }
  out.push({ step: "auth-me", ok: true, note: "session valid" });

  const tenantRes = await apiJson(base, "/api/v1/tenant", {
    method: "PATCH",
    headers: {
      ...authHeaders(accessToken),
      "Idempotency-Key": `smoke-tenant-${Date.now()}`,
    },
    body: JSON.stringify({ name: seed.name, nip: seed.nip }),
  });
  if (!tenantRes.res.ok) {
    const msg = errMsg(tenantRes.body, `tenant update failed (${tenantRes.res.status})`);
    out.push({ step: "tenant-profile", ok: false, note: msg });
    throw new Error(msg);
  }
  out.push({ step: "tenant-profile", ok: true, note: `NIP saved (${seed.nip})` });

  const requireKsef = process.env.SMOKE_REQUIRE_KSEF === "1";
  const ksefToken = process.env.SMOKE_KSEF_TOKEN?.trim() ?? "";
  if (!ksefToken) {
    const note = "SMOKE_KSEF_TOKEN not set — KSeF self-service part skipped";
    out.push({ step: "ksef-self-service", ok: !requireKsef, note });
    if (requireKsef) throw new Error(note);
  } else {
    const ksefEnv = process.env.SMOKE_KSEF_ENV?.trim();
    if (ksefEnv) {
      if (ksefEnv !== "sandbox" && ksefEnv !== "production") {
        throw new Error("SMOKE_KSEF_ENV must be sandbox or production");
      }
      const envRes = await apiJson(base, "/api/v1/connectors/ksef/settings", {
        method: "PATCH",
        headers: {
          ...authHeaders(accessToken),
          "Idempotency-Key": `smoke-ksef-env-${Date.now()}`,
        },
        body: JSON.stringify({ ksefApiEnv: ksefEnv }),
      });
      if (!envRes.res.ok) throw new Error(`ksef env failed: ${errMsg(envRes.body, `HTTP ${envRes.res.status}`)}`);
      out.push({ step: "ksef-env", ok: true, note: ksefEnv });
    }

    const saveRes = await apiJson(base, "/api/v1/tenant/ksef-credentials", {
      method: "PUT",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        ksefTokenOrEncryptedBlob: ksefToken,
        tokenPassword: process.env.SMOKE_KSEF_PIN?.trim() || null,
        certPemOrDerBase64: process.env.SMOKE_KSEF_CERT?.trim() || null,
      }),
    });
    if (!saveRes.res.ok) throw new Error(`ksef save failed: ${errMsg(saveRes.body, `HTTP ${saveRes.res.status}`)}`);
    out.push({ step: "ksef-save", ok: true, note: "credentials saved" });

    const testRes = await apiJson(base, "/api/v1/tenant/ksef-credentials/test", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({}),
    });
    if (!testRes.res.ok || testRes.body.ok !== true) {
      throw new Error(`ksef test failed: ${errMsg(testRes.body, JSON.stringify(testRes.body))}`);
    }
    out.push({ step: "ksef-test", ok: true, note: "auth test passed" });

    const syncRes = await apiJson(base, "/api/v1/connectors/ksef/sync", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({}),
    });
    if (!syncRes.res.ok) throw new Error(`ksef sync failed: ${errMsg(syncRes.body, `HTTP ${syncRes.res.status}`)}`);
    out.push({ step: "ksef-sync", ok: true, note: "sync queued" });

    const statusRes = await apiJson(base, "/api/v1/connectors/ksef/status", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!statusRes.res.ok) throw new Error(`ksef status failed: ${errMsg(statusRes.body, `HTTP ${statusRes.res.status}`)}`);
    out.push({
      step: "ksef-status",
      ok: true,
      note: `configured=${String((statusRes.body as { configured?: unknown }).configured ?? false)}, invoices=${String(
        (statusRes.body as { invoiceCount?: unknown }).invoiceCount ?? 0,
      )}`,
    });
  }

  console.log("[smoke] PASS");
  for (const row of out) {
    console.log(` - ${row.ok ? "OK" : "ERR"} ${row.step}: ${row.note}`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[smoke] FAIL: ${msg}`);
  process.exitCode = 1;
});

