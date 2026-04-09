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

import { createPublicKey, publicEncrypt, constants as cryptoConstants } from "node:crypto";

const KSEF_URLS: Record<string, string> = {
  production: "https://api.ksef.mf.gov.pl/v2",
  sandbox: "https://ksef-test.mf.gov.pl/api/v2",
};

const MAX_AUTH_POLL_ATTEMPTS = 20;
const AUTH_POLL_INTERVAL_MS = 3_000;

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

// ─── Client ───

export class KsefClient {
  private readonly baseUrl: string;
  private tokens: KsefSessionTokens | null = null;

  constructor(
    env: "production" | "sandbox",
    private readonly ksefToken: string,
    private readonly nip: string,
  ) {
    this.baseUrl = KSEF_URLS[env]!;
  }

  get isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  /** Full auth handshake: challenge → encrypt → init → poll → redeem tokens. */
  async authenticate(): Promise<KsefSessionTokens> {
    const { challenge, timestampMs } = await this.getChallenge();
    const publicKey = await this.fetchPublicKey();
    const encrypted = this.encryptToken(this.ksefToken, timestampMs, publicKey);

    const { referenceNumber, authToken } = await this.initTokenAuth(challenge, encrypted);
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
  ): Promise<KsefMetadataPage> {
    const body = {
      subjectType,
      dateRange: { dateType: "PermanentStorage", from, to },
    };
    const params = new URLSearchParams({
      sortOrder: "Asc",
      pageOffset: String(pageOffset),
      pageSize: String(Math.min(pageSize, 250)),
    });
    const res = await this.authedFetch(`/invoices/query/metadata?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.apiError(res, "query metadata");
    return (await res.json()) as KsefMetadataPage;
  }

  /** Download raw invoice XML by KSeF number. */
  async fetchInvoiceXml(ksefNumber: string): Promise<string> {
    const res = await this.authedFetch(`/invoices/ksef/${encodeURIComponent(ksefNumber)}`, {
      headers: { Accept: "application/xml" },
    });
    if (!res.ok) throw await this.apiError(res, `fetch invoice ${ksefNumber}`);
    return res.text();
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
  private encryptToken(ksefToken: string, timestampMs: number, publicKeyBase64: string): string {
    const derBuffer = Buffer.from(publicKeyBase64, "base64");
    const key = createPublicKey({ key: derBuffer, format: "der", type: "spki" });
    const plaintext = Buffer.from(`${ksefToken}|${timestampMs}`, "utf-8");
    const encrypted = publicEncrypt(
      { key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      plaintext,
    );
    return encrypted.toString("base64");
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
