/**
 * KSeF v2 API HTTP client.
 *
 * Auth flow (token-based):
 *   1. POST /auth/challenge              → { challenge, timestampMs }
 *   2. Encrypt `ksefToken|timestampMs`   with MF public RSA key (OAEP + SHA-256)
 *   3. POST /auth/ksef-token             → { referenceNumber, authenticationToken }
 *   4. GET  /auth/{ref}                  → poll until status.code === 200
 *   5. POST /auth/token/redeem           → { accessToken, refreshToken }
 *   6. POST /auth/token/refresh          → renew expired accessToken
 *
 * Invoice pull:
 *   POST /invoices/query/metadata        → paginated metadata (incremental via permanentStorageDate)
 *   GET  /invoices/ksef/{ksefNumber}     → raw invoice XML
 */

import {
  publicEncrypt,
  pbkdf2Sync,
  createDecipheriv,
  X509Certificate,
  constants as cryptoConstants,
} from "node:crypto";
import { signAuthTokenRequest } from "./ksef-xades-signer.js";

const KSEF_URLS: Record<string, string> = {
  production: "https://api.ksef.mf.gov.pl/v2",
  sandbox: "https://ksef-test.mf.gov.pl/api/v2",
};

// P2-8 z research/ksef-batch-stability.md (Resta-FV vault): poprzedni budżet 20×3s=60s był za krótki
// na peak hours MF (np. styczeń deadline JPK, ~10. dnia miesiąca) — XAdES auth wolniejszy.
// Bump do 40×3s=120s. AUTH_POLL_INTERVAL_MS bez zmian (3s krok zachowuje granulację raportowania).
export const MAX_AUTH_POLL_ATTEMPTS = 40;
export const AUTH_POLL_INTERVAL_MS = 3_000;

// ─── Types ───

export type KsefSessionTokens = {
  accessToken: string;
  accessValidUntil: string;
  refreshToken: string;
  refreshValidUntil: string;
};

export type KsefInvoiceMetadata = {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  invoicingDate: string;
  permanentStorageDate: string;
  seller: { nip: string; name: string };
  buyer: { identifier: { type: string; value: string }; name: string } | null;
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  invoiceType: string;
  invoiceHash: string;
};

export type KsefMetadataPage = {
  hasMore: boolean;
  isTruncated: boolean;
  permanentStorageHwmDate: string;
  invoices: KsefInvoiceMetadata[];
};

// ─── PKCS#5 / PBES2 token decryption ───

/**
 * Decrypt a PKCS#5 PBES2-encrypted KSeF token blob.
 * Structure: SEQUENCE { AlgorithmIdentifier(PBES2 { PBKDF2, AES-256-CBC }), OCTET STRING(ciphertext) }
 */
export function decryptKsefTokenPkcs5(encryptedBase64: string, password: string): string {
  return decryptKsefPkcs5Raw(encryptedBase64, password).toString("utf-8").trim();
}

export function decryptKsefPkcs5Raw(encryptedBase64: string, password: string): Buffer {
  const buf = Buffer.from(encryptedBase64, "base64");
  const { salt, iterations, iv, ciphertext } = parsePbes2Asn1(buf);
  const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function parsePbes2Asn1(buf: Buffer): {
  salt: Buffer;
  iterations: number;
  iv: Buffer;
  ciphertext: Buffer;
} {
  let pos = 0;

  function readTag(): { tag: number; length: number } {
    const tag = buf[pos++]!;
    let length = buf[pos++]!;
    if (length & 0x80) {
      const numBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | buf[pos++]!;
      }
    }
    return { tag, length };
  }

  function readBytes(len: number): Buffer {
    const slice = buf.subarray(pos, pos + len);
    pos += len;
    return slice;
  }

  function expectSequence(): number {
    const { tag, length } = readTag();
    if (tag !== 0x30) throw new Error(`Expected SEQUENCE (0x30), got 0x${tag.toString(16)}`);
    return length;
  }

  function expectOid(): Buffer {
    const { tag, length } = readTag();
    if (tag !== 0x06) throw new Error(`Expected OID (0x06), got 0x${tag.toString(16)}`);
    return readBytes(length);
  }

  function expectOctetString(): Buffer {
    const { tag, length } = readTag();
    if (tag !== 0x04) throw new Error(`Expected OCTET STRING (0x04), got 0x${tag.toString(16)}`);
    return readBytes(length);
  }

  function expectInteger(): number {
    const { tag, length } = readTag();
    if (tag !== 0x02) throw new Error(`Expected INTEGER (0x02), got 0x${tag.toString(16)}`);
    const bytes = readBytes(length);
    let val = 0;
    for (const b of bytes) val = (val << 8) | b;
    return val;
  }

  // outer SEQUENCE
  expectSequence();
  // AlgorithmIdentifier SEQUENCE (PBES2)
  expectSequence();
  const pbes2Oid = expectOid();
  if (!pbes2Oid.equals(Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d]))) {
    throw new Error("Not a PBES2 encrypted structure.");
  }
  // PBES2 params SEQUENCE
  expectSequence();
  // PBKDF2 params SEQUENCE
  expectSequence();
  const pbkdf2Oid = expectOid();
  if (!pbkdf2Oid.equals(Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0c]))) {
    throw new Error("Expected PBKDF2 OID.");
  }
  // PBKDF2 inner params
  expectSequence();
  const salt = expectOctetString();
  const iterations = expectInteger();
  // optional PRF AlgorithmIdentifier (HMAC-SHA256)
  if (buf[pos] === 0x30) {
    const prfLen = readTag().length;
    readBytes(prfLen); // skip PRF params
  }
  // Encryption scheme SEQUENCE (AES-256-CBC)
  expectSequence();
  expectOid(); // AES-256-CBC OID — skip
  const iv = expectOctetString();
  // Ciphertext OCTET STRING
  const ciphertext = expectOctetString();

  return { salt, iterations, iv, ciphertext };
}

/**
 * KSeF env values may be PEM blocks or a single base64 line. Returns inner base64 (no whitespace).
 */
export function normalizeKsefPemOrBareBase64(raw: string): string {
  const t = raw.trim();
  if (t.includes("BEGIN")) {
    return t
      .replace(/-----BEGIN [^-]+-----/g, "")
      .replace(/-----END [^-]+-----/g, "")
      .replace(/\s/g, "");
  }
  return t.replace(/\s/g, "");
}

// ─── Client ───

type AuthMode =
  | { kind: "token"; ksefToken: string }
  | { kind: "certificate"; privateKeyDer: Buffer; certDer: Buffer };

export class KsefClient {
  private readonly baseUrl: string;
  private tokens: KsefSessionTokens | null = null;

  constructor(
    env: "production" | "sandbox",
    private readonly nip: string,
    private readonly authMode: AuthMode,
  ) {
    this.baseUrl = KSEF_URLS[env]!;
  }

  /**
   * Create a KsefClient from an encrypted PKCS#5 token blob + password (token-based auth).
   */
  static fromEncryptedToken(
    env: "production" | "sandbox",
    encryptedTokenBase64: string,
    password: string,
    nip: string,
  ): KsefClient {
    const rawToken = decryptKsefTokenPkcs5(normalizeKsefPemOrBareBase64(encryptedTokenBase64), password);
    console.info(`[KSeF] Token decrypted OK (${rawToken.length} chars).`);
    return new KsefClient(env, nip, { kind: "token", ksefToken: rawToken });
  }

  /**
   * Create a KsefClient from an encrypted PKCS#5 private key + DER certificate (XAdES auth).
   */
  static fromEncryptedCertificate(
    env: "production" | "sandbox",
    encryptedKeyPemOrBase64: string,
    password: string,
    certPemOrBase64: string,
    nip: string,
  ): KsefClient {
    const keyB64 = normalizeKsefPemOrBareBase64(encryptedKeyPemOrBase64);
    const privateKeyDer = decryptKsefPkcs5Raw(keyB64, password);
    console.info(`[KSeF] Private key decrypted OK (${privateKeyDer.length} bytes).`);
    const certDer = Buffer.from(normalizeKsefPemOrBareBase64(certPemOrBase64), "base64");
    return new KsefClient(env, nip, { kind: "certificate", privateKeyDer, certDer });
  }

  get isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  /** Full auth handshake — dispatches to token or XAdES based on auth mode. */
  async authenticate(): Promise<KsefSessionTokens> {
    if (this.authMode.kind === "certificate") {
      return this.authenticateXades();
    }
    return this.authenticateToken();
  }

  private async authenticateToken(): Promise<KsefSessionTokens> {
    if (this.authMode.kind !== "token") throw new Error("Token auth mode required.");
    const { challenge, timestampMs } = await this.getChallenge();
    const publicKey = await this.fetchPublicKey();
    const encrypted = this.encryptToken(this.authMode.ksefToken, timestampMs, publicKey);

    const { referenceNumber, authToken } = await this.initTokenAuth(challenge, encrypted);
    await this.pollAuthStatus(referenceNumber, authToken);
    this.tokens = await this.redeemTokens(authToken);
    return this.tokens;
  }

  private async authenticateXades(): Promise<KsefSessionTokens> {
    if (this.authMode.kind !== "certificate") throw new Error("Certificate auth mode required.");
    const { challenge } = await this.getChallenge();

    const signedXml = signAuthTokenRequest({
      challenge,
      nip: this.nip,
      privateKeyDer: this.authMode.privateKeyDer,
      certDer: this.authMode.certDer,
    });
    console.info("[KSeF] XAdES signed XML created, sending to /auth/xades-signature…");

    const { referenceNumber, authToken } = await this.initXadesAuth(signedXml);
    await this.pollAuthStatus(referenceNumber, authToken);
    this.tokens = await this.redeemTokens(authToken);
    return this.tokens;
  }

  /** Refresh expired access token using the stored refresh token. */
  async refreshAccessToken(): Promise<void> {
    if (!this.tokens) throw new Error("Not authenticated — call authenticate() first.");
    const res = await fetch(`${this.baseUrl}/auth/token/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.tokens.refreshToken}` },
    });
    if (!res.ok) throw await this.apiError(res, "refresh token");
    const body = (await res.json()) as { accessToken: { token: string; validUntil: string } };
    this.tokens.accessToken = body.accessToken.token;
    this.tokens.accessValidUntil = body.accessToken.validUntil;
  }

  /**
   * Query invoice metadata (incremental).
   * Uses `permanentStorageDate` + `Asc` sort for reliable incremental sync.
   */
  async queryMetadata(
    from: string,
    to: string,
    pageOffset = 0,
    pageSize = 100,
    subjectType: "Subject1" | "Subject2" = "Subject1",
    /** `PermanentStorage` — przyrost MF; `Issue` — data wystawienia (jak w portalu) — uzupełnia luki przy rozjazdach. */
    dateType: "PermanentStorage" | "Issue" = "PermanentStorage",
  ): Promise<KsefMetadataPage> {
    const body = {
      subjectType,
      dateRange: { dateType, from, to },
    };
    const bodyStr = JSON.stringify(body);
    const params = new URLSearchParams({
      sortOrder: "Asc",
      pageOffset: String(pageOffset),
      pageSize: String(Math.min(pageSize, 250)),
    });
    const path = `/invoices/query/metadata?${params}`;
    const max429Attempts = 12;

    for (let attempt = 0; attempt < max429Attempts; attempt++) {
      const res = await this.authedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
      });
      if (res.status === 429) {
        const text = await res.text();
        const waitMs = parseKsefMetadata429WaitMs(res, text);
        console.warn(
          `[KSeF] query metadata 429 (${dateType}/${subjectType} offset=${pageOffset}), czekam ${waitMs}ms… ${text.slice(0, 160)}`,
        );
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) throw await this.apiError(res, "query metadata");
      return (await res.json()) as KsefMetadataPage;
    }
    throw new Error(
      `KSeF query metadata: nadal 429 po ${max429Attempts} próbach (${dateType}/${subjectType} offset=${pageOffset}).`,
    );
  }

  /**
   * Download raw invoice XML by KSeF number.
   * Ponawia również 404/5xx — przy nowych fakturach metadane z `query/metadata` bywają szybciej
   * niż gotowość `GET /invoices/ksef/…` (lub błąd chwilowy MF), co skutkowało pustką aż do
   * ręcznego „Odśwież” / kolejnego auto-syncu.
   */
  async fetchInvoiceXml(ksefNumber: string): Promise<string> {
    const path = `/invoices/ksef/${encodeURIComponent(ksefNumber)}`;
    const max429Attempts = 12;
    const maxTransientXmlAttempts = 5;
    for (let attempt = 0; attempt < max429Attempts; attempt++) {
      for (let transientTry = 0; transientTry < maxTransientXmlAttempts; transientTry++) {
        const res = await this.authedFetch(path, {
          headers: { Accept: "application/xml" },
        });
        if (res.status === 429) {
          const text = await res.text();
          const waitMs = parseKsefMetadata429WaitMs(res, text);
          console.warn(
            `[KSeF] fetch XML 429 (${ksefNumber}), czekam ${waitMs}ms… ${text.slice(0, 120)}`,
          );
          await sleep(waitMs);
          break;
        }
        if (res.ok) return res.text();
        const errText = await res.text();
        if (isTransientKsefXmlFetchStatus(res.status) && transientTry < maxTransientXmlAttempts - 1) {
          const waitMs = Math.min(25_000, 2_000 * 2 ** transientTry);
          console.warn(
            `[KSeF] fetch XML ${res.status} (${ksefNumber}), czekam ${waitMs}ms (transient ${transientTry + 1}/${maxTransientXmlAttempts})… ${errText.slice(0, 160)}`,
          );
          await sleep(waitMs);
          continue;
        }
        throw new Error(`KSeF fetch invoice ${ksefNumber} failed (${res.status}): ${errText.slice(0, 500)}`);
      }
    }
    throw new Error(`KSeF fetch invoice XML: nadal 429 po ${max429Attempts} próbach (${ksefNumber}).`);
  }

  /**
   * Sesja interaktywna (online) — inicjalizacja przed wysłaniem FA.
   * Kształt body zależy od wersji OpenAPI MF; domyślnie `formCode` FA(3).
   */
  async openOnlineSessionForm(body: Record<string, unknown>): Promise<unknown> {
    const res = await this.authedFetch("/sessions/online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.apiError(res, "open online session");
    return res.json() as Promise<unknown>;
  }

  /** Wysłanie faktury w ramach sesji online (payload zależny od wersji API). */
  async postOnlineInvoice(sessionReferenceNumber: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await this.authedFetch(
      `/sessions/online/${encodeURIComponent(sessionReferenceNumber)}/invoices`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw await this.apiError(res, "post online invoice");
    return res.json() as Promise<unknown>;
  }

  async closeOnlineSession(sessionReferenceNumber: string): Promise<unknown> {
    const res = await this.authedFetch(
      `/sessions/online/${encodeURIComponent(sessionReferenceNumber)}/close`,
      { method: "POST" },
    );
    if (!res.ok) throw await this.apiError(res, "close online session");
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  // ─── Auth internals ───

  private async getChallenge(): Promise<{ challenge: string; timestampMs: number }> {
    const res = await fetch(`${this.baseUrl}/auth/challenge`, { method: "POST" });
    if (!res.ok) throw await this.apiError(res, "auth challenge");
    const body = (await res.json()) as { challenge: string; timestampMs: number };
    return { challenge: body.challenge, timestampMs: body.timestampMs };
  }

  private async fetchPublicKey(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/security/public-key-certificates`);
    if (!res.ok) throw await this.apiError(res, "fetch public key");
    const certs = (await res.json()) as Array<{ certificate: string; usage: string[] }>;
    const tokenCert = certs.find((c) => c.usage.includes("KsefTokenEncryption"));
    if (!tokenCert) throw new Error("KSeF: no KsefTokenEncryption certificate found.");
    return tokenCert.certificate;
  }

  /** Encrypt `ksefToken|timestampMs` with MF public RSA key using RSA-OAEP + SHA-256. */
  private encryptToken(ksefToken: string, timestampMs: number, certBase64: string): string {
    const certDer = Buffer.from(certBase64, "base64");
    const x509 = new X509Certificate(certDer);
    const plaintext = Buffer.from(`${ksefToken}|${timestampMs}`, "utf-8");
    const encrypted = publicEncrypt(
      { key: x509.publicKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      plaintext,
    );
    return encrypted.toString("base64");
  }

  private async initXadesAuth(signedXml: string): Promise<{ referenceNumber: string; authToken: string }> {
    const res = await fetch(`${this.baseUrl}/auth/xades-signature`, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: signedXml,
    });
    if (!res.ok) throw await this.apiError(res, "xades auth");
    const body = (await res.json()) as {
      referenceNumber: string;
      authenticationToken: { token: string };
    };
    return { referenceNumber: body.referenceNumber, authToken: body.authenticationToken.token };
  }

  private async initTokenAuth(
    challenge: string,
    encryptedToken: string,
  ): Promise<{ referenceNumber: string; authToken: string }> {
    const res = await fetch(`${this.baseUrl}/auth/ksef-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge,
        contextIdentifier: { type: "Nip", value: this.nip },
        encryptedToken,
      }),
    });
    if (!res.ok) throw await this.apiError(res, "init token auth");
    const body = (await res.json()) as {
      referenceNumber: string;
      authenticationToken: { token: string };
    };
    return { referenceNumber: body.referenceNumber, authToken: body.authenticationToken.token };
  }

  private async pollAuthStatus(referenceNumber: string, authToken: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_AUTH_POLL_ATTEMPTS; attempt++) {
      await sleep(AUTH_POLL_INTERVAL_MS);
      const res = await fetch(`${this.baseUrl}/auth/${encodeURIComponent(referenceNumber)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw await this.apiError(res, "poll auth status");
      const body = (await res.json()) as { status: { code: number; description: string; details?: string[] } };
      if (body.status.code === 200) return;
      if (body.status.code >= 400) {
        throw new Error(`KSeF auth failed: ${body.status.description} ${(body.status.details ?? []).join("; ")}`);
      }
    }
    throw new Error(`KSeF auth polling timed out after ${MAX_AUTH_POLL_ATTEMPTS} attempts.`);
  }

  private async redeemTokens(authToken: string): Promise<KsefSessionTokens> {
    const res = await fetch(`${this.baseUrl}/auth/token/redeem`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw await this.apiError(res, "redeem tokens");
    const body = (await res.json()) as {
      accessToken: { token: string; validUntil: string };
      refreshToken: { token: string; validUntil: string };
    };
    return {
      accessToken: body.accessToken.token,
      accessValidUntil: body.accessToken.validUntil,
      refreshToken: body.refreshToken.token,
      refreshValidUntil: body.refreshToken.validUntil,
    };
  }

  // ─── Helpers ───

  /** Make an authenticated request, auto-refreshing access token if expired. */
  private async authedFetch(path: string, init?: RequestInit): Promise<Response> {
    if (!this.tokens) throw new Error("Not authenticated — call authenticate() first.");
    const doFetch = () =>
      fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${this.tokens!.accessToken}`,
        },
      });
    let res = await doFetch();
    if (res.status === 401) {
      await this.refreshAccessToken();
      res = await doFetch();
    }
    return res;
  }

  private async apiError(res: Response, context: string): Promise<Error> {
    let detail = "";
    try {
      const body = await res.text();
      detail = body.slice(0, 500);
    } catch { /* ignore */ }
    return new Error(`KSeF ${context} failed (${res.status}): ${detail}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 404: częste przy chwilowym rozjazdzie listy metadanych a treścią FA.
 * 5xx/408/425: przejściowe błędy usług MF.
 */
function isTransientKsefXmlFetchStatus(status: number): boolean {
  if (status === 404) return true;
  if (status === 408 || status === 425) return true;
  return status >= 500 && status < 600;
}

/** MF: nagłówek Retry-After (sekundy) lub treść „Spróbuj ponownie po N sekundach”. */
function parseKsefMetadata429WaitMs(res: Response, bodyText: string): number {
  const ra = res.headers.get("retry-after")?.trim();
  if (ra && /^\d+$/.test(ra)) {
    return Math.min(600_000, Math.max(5_000, parseInt(ra, 10) * 1000));
  }
  const m = bodyText.match(/po\s+(\d+)\s+sekund/i);
  if (m?.[1]) {
    return Math.min(600_000, Math.max(5_000, parseInt(m[1], 10) * 1000 + 2_000));
  }
  return 70_000;
}
