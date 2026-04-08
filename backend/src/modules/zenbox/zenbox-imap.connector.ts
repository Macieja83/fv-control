import { ImapFlow } from "imapflow";
import type { MessageEnvelopeObject } from "imapflow";
import { loadConfig } from "../../config.js";
import type { ZenboxImapCredentialsPlain } from "./zenbox-credentials.service.js";
import { classifyImapFailure, ZenboxImapRetryableError } from "./zenbox-imap-errors.js";

export type FetchedImapMessage = {
  uid: bigint;
  internalDate?: Date;
  envelope?: MessageEnvelopeObject;
  rawSource: Buffer;
};

export interface ZenboxImapTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchMailboxMetadata(): Promise<{ uidValidityStr: string; exists: boolean }>;
  /** UIDs strictly greater than `lastProcessedUid` (or from 1 if null), sorted ascending, max `batchSize`. */
  listUidsAfter(lastProcessedUid: bigint | null, batchSize: number): Promise<number[]>;
  fetchRawByUids(uids: number[]): Promise<FetchedImapMessage[]>;
}

function imapTimeouts() {
  const cfg = loadConfig();
  return {
    connectionTimeout: cfg.IMAP_FLOW_CONNECTION_TIMEOUT_MS,
    greetingTimeout: cfg.IMAP_FLOW_GREETING_TIMEOUT_MS,
    socketTimeout: cfg.IMAP_FLOW_SOCKET_TIMEOUT_MS,
  };
}

/**
 * Live Zenbox / IMAP adapter (ImapFlow). New instance per sync run — ImapFlow does not allow reconnect on the same object.
 */
export class ZenboxImapFlowTransport implements ZenboxImapTransport {
  private client: ImapFlow | null = null;
  private onClientError: ((err: unknown) => void) | null = null;

  constructor(private readonly creds: ZenboxImapCredentialsPlain) {}

  async connect(): Promise<void> {
    await this.disconnect();
    const t = imapTimeouts();
    const client = new ImapFlow({
      host: this.creds.host,
      port: this.creds.port,
      secure: this.creds.tls,
      auth: { user: this.creds.username, pass: this.creds.password },
      logger: false,
      ...t,
    });
    // ImapFlow may emit `error` on socket timeout; without a listener Node treats it as fatal.
    this.onClientError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[imap] client error (${this.creds.host}:${this.creds.port}): ${msg}`);
    };
    client.on("error", this.onClientError);
    this.client = client;
    try {
      await client.connect();
    } catch (e) {
      if (this.onClientError) {
        client.off("error", this.onClientError);
        this.onClientError = null;
      }
      this.client = null;
      throw classifyImapFailure(e);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    const c = this.client;
    if (this.onClientError) {
      c.off("error", this.onClientError);
      this.onClientError = null;
    }
    this.client = null;
    try {
      await c.logout();
    } catch {
      c.close();
    }
  }

  async fetchMailboxMetadata(): Promise<{ uidValidityStr: string; exists: boolean }> {
    const client = this.requireClient();
    const path = this.creds.mailbox;
    try {
      await client.mailboxOpen(path);
    } catch (e) {
      throw classifyImapFailure(e);
    }
    const mb = client.mailbox;
    if (!mb) {
      throw new ZenboxImapRetryableError("IMAP mailbox not selected after open");
    }
    return {
      uidValidityStr: mb.uidValidity.toString(),
      exists: mb.exists > 0,
    };
  }

  async listUidsAfter(lastProcessedUid: bigint | null, batchSize: number): Promise<number[]> {
    const client = this.requireClient();
    const startNum = lastProcessedUid === null || lastProcessedUid < 0n ? 1 : Number(lastProcessedUid) + 1;
    if (!Number.isSafeInteger(startNum) || startNum < 1) {
      throw new ZenboxImapRetryableError("Invalid IMAP UID cursor");
    }
    try {
      const list = await client.search({ uid: `${startNum}:*` }, { uid: true });
      if (!list || list.length === 0) return [];
      const sorted = [...list].sort((a, b) => a - b);
      return sorted.slice(0, batchSize);
    } catch (e) {
      throw classifyImapFailure(e);
    }
  }

  async fetchRawByUids(uids: number[]): Promise<FetchedImapMessage[]> {
    if (uids.length === 0) return [];
    const client = this.requireClient();
    const out: FetchedImapMessage[] = [];
    try {
      for await (const msg of client.fetch(uids, { envelope: true, source: true, internalDate: true }, { uid: true })) {
        const uid = msg.uid !== undefined ? BigInt(msg.uid) : null;
        const src = msg.source;
        if (uid === null || !Buffer.isBuffer(src)) continue;
        const idate = msg.internalDate;
        const internalDate =
          idate instanceof Date ? idate : typeof idate === "string" ? new Date(idate) : undefined;
        out.push({
          uid,
          internalDate,
          envelope: msg.envelope,
          rawSource: src,
        });
      }
    } catch (e) {
      throw classifyImapFailure(e);
    }
    return out;
  }

  private requireClient(): ImapFlow {
    if (!this.client) {
      throw new ZenboxImapRetryableError("IMAP client not connected");
    }
    return this.client;
  }
}

export function createZenboxImapTransport(creds: ZenboxImapCredentialsPlain): ZenboxImapTransport {
  return new ZenboxImapFlowTransport(creds);
}
