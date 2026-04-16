/**
 * Minimal smoke test przed release:
 * register tenant -> verify email -> login -> auth/me.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:3000 npx tsx scripts/smoke-tenant-journey.ts
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
  return { name, email, password: "SmokePass123!" };
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

