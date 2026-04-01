/**
 * Connector contracts (adapters implement; workers call through registry).
 * Gmail / Zenbox IMAP / KSeF / Resta — concrete implementations are staged per rollout plan.
 *
 * Gmail: multi-account = multiple mailboxes each with `IntegrationCredential` (OAuth2 refresh token).
 * IMAP Zenbox: UID cursor in `mailbox_sync_state` (`uidValidity`, `uidNext`).
 */

export type GmailSyncCursor = { historyId?: string | null };

export type GmailConnector = {
  readonly name: "gmail";
  fetchIncremental(mailboxId: string, cursor: GmailSyncCursor): Promise<{
    nextCursor: GmailSyncCursor;
    attachmentRefs: Array<{ messageId: string; attachmentId: string; filename: string }>;
  }>;
};

export type ImapSyncCursor = { uidValidity?: number | null; uidNext?: number | null };

export type ImapConnector = {
  readonly name: "imap_zenbox";
  poll(mailboxId: string, cursor: ImapSyncCursor): Promise<{
    nextCursor: ImapSyncCursor;
    rawMimeIds: string[];
  }>;
};

export type KsefInvoiceRef = { externalId: string; status: string; acquiredAt: string };

export type KsefConnector = {
  readonly name: "ksef";
  listSince(since: Date): Promise<KsefInvoiceRef[]>;
  fetchOne(externalId: string): Promise<{ xml: string; metadata: Record<string, string> }>;
};

export type RestaInvoiceDto = {
  externalId: string;
  number?: string;
  nip?: string;
  gross?: string;
  currency?: string;
};

export type RestaPosConnector = {
  readonly name: "resta_pos";
  listInvoices(params: { modifiedSince?: Date }): Promise<RestaInvoiceDto[]>;
};

export function createStubGmailConnector(): GmailConnector {
  return {
    name: "gmail",
    async fetchIncremental(_mailboxId, cursor) {
      return { nextCursor: { historyId: cursor.historyId ?? "stub" }, attachmentRefs: [] };
    },
  };
}

export function createStubImapConnector(): ImapConnector {
  return {
    name: "imap_zenbox",
    async poll(_mailboxId, cursor) {
      return { nextCursor: { uidValidity: cursor.uidValidity ?? 1, uidNext: cursor.uidNext ?? 1 }, rawMimeIds: [] };
    },
  };
}

export function createStubKsefConnector(): KsefConnector {
  return {
    name: "ksef",
    async listSince() {
      return [];
    },
    async fetchOne(externalId) {
      return { xml: "", metadata: { id: externalId } };
    },
  };
}

export function createStubRestaConnector(): RestaPosConnector {
  return {
    name: "resta_pos",
    async listInvoices() {
      return [];
    },
  };
}
