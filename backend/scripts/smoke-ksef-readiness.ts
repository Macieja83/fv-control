/**
 * Smoke KSeF readiness dla istniejącego tenanta.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:3000 \
 *   SMOKE_EMAIL=owner@example.com \
 *   SMOKE_PASSWORD=Secret123! \
 *   npx tsx scripts/smoke-ksef-readiness.ts
 *
 * Optional:
 *   SMOKE_ALLOW_KSEF_MISSING=1   # nie failuj gdy tenant nie ma jeszcze zapisanych poświadczeń
 */

type Json = Record<string, unknown>;

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function baseUrl(): string {
  const raw = (process.env.SMOKE_BASE_URL || "http://localhost:3000").trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function readJsonSafe(res: Response): Promise<Json> {
  try {
    return (await res.json()) as Json;
  } catch {
    return {};
  }
}

function errMessage(body: Json, status: number): string {
  const e = body.error;
  if (typeof e === "string" && e.trim()) return e.trim();
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    const msg = (e as { message: string }).message.trim();
    if (msg) return msg;
  }
  return `HTTP ${status}`;
}

async function main() {
  const base = baseUrl();
  const email = env("SMOKE_EMAIL");
  const password = env("SMOKE_PASSWORD");
  const allowMissing = process.env.SMOKE_ALLOW_KSEF_MISSING === "1";
  const rows: Array<{ step: string; ok: boolean; note: string }> = [];

  const loginRes = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await readJsonSafe(loginRes);
  if (!loginRes.ok) throw new Error(`login failed: ${errMessage(loginBody, loginRes.status)}`);
  const token = typeof loginBody.accessToken === "string" ? loginBody.accessToken : "";
  if (!token) throw new Error("login failed: missing accessToken");
  rows.push({ step: "login", ok: true, note: "access token issued" });

  const meRes = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  const meBody = await readJsonSafe(meRes);
  if (!meRes.ok) throw new Error(`auth/me failed: ${errMessage(meBody, meRes.status)}`);
  rows.push({ step: "auth-me", ok: true, note: "session valid" });

  const credsRes = await fetch(`${base}/api/v1/tenant/ksef-credentials`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const credsBody = await readJsonSafe(credsRes);
  if (!credsRes.ok) throw new Error(`tenant/ksef-credentials failed: ${errMessage(credsBody, credsRes.status)}`);
  rows.push({
    step: "ksef-credentials-public",
    ok: true,
    note: `storedCredential=${String((credsBody as { storedCredential?: unknown }).storedCredential ?? false)}`,
  });

  const statusRes = await fetch(`${base}/api/v1/connectors/ksef/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const statusBody = await readJsonSafe(statusRes);
  if (!statusRes.ok) throw new Error(`connectors/ksef/status failed: ${errMessage(statusBody, statusRes.status)}`);
  rows.push({
    step: "ksef-status",
    ok: true,
    note: `environment=${String((statusBody as { environment?: unknown }).environment ?? "unknown")}`,
  });

  const testRes = await fetch(`${base}/api/v1/tenant/ksef-credentials/test`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const testBody = await readJsonSafe(testRes);
  const testMessage =
    typeof (testBody as { message?: unknown }).message === "string"
      ? ((testBody as { message: string }).message || "").trim()
      : "";
  if (!testRes.ok) {
    const msg = errMessage(testBody, testRes.status);
    const looksLikeMissingCreds =
      /nie jest skonfigurowany|brak poświadczeń|missing|credentials/i.test(msg);
    if (!(allowMissing && looksLikeMissingCreds)) {
      throw new Error(`ksef test failed: ${msg}`);
    }
    rows.push({ step: "ksef-test", ok: true, note: `allowed missing credentials: ${msg}` });
  } else {
    const ok = (testBody as { ok?: unknown }).ok === true;
    if (!ok) {
      const looksLikeNonLiveEnv = /brak realnego api ksef|mock|sandbox|produkcja/i.test(testMessage);
      if (!(allowMissing && looksLikeNonLiveEnv)) {
        throw new Error(`ksef test failed: response ok=false (${JSON.stringify(testBody)})`);
      }
      rows.push({ step: "ksef-test", ok: true, note: `allowed non-live KSeF mode: ${testMessage || "ok=false"}` });
      console.log("[smoke-ksef] PASS");
      for (const r of rows) {
        console.log(` - OK ${r.step}: ${r.note}`);
      }
      return;
    }
    rows.push({ step: "ksef-test", ok: true, note: "connection test passed" });
  }

  console.log("[smoke-ksef] PASS");
  for (const r of rows) {
    console.log(` - OK ${r.step}: ${r.note}`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[smoke-ksef] FAIL: ${msg}`);
  process.exitCode = 1;
});

