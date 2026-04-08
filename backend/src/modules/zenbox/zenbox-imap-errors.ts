export class ZenboxImapRetryableError extends Error {
  readonly retryable = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZenboxImapRetryableError";
  }
}

export class ZenboxImapPermanentError extends Error {
  readonly retryable = false as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZenboxImapPermanentError";
  }
}

/** ImapFlow uses message "Command failed" but sets responseText / responseStatus on the Error. */
export function imapFailureDetailForLogs(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & {
    responseText?: string;
    responseStatus?: string;
    executedCommand?: string;
    code?: string;
  };
  const bits: string[] = [e.message];
  if (e.responseStatus) bits.push(`imap=${e.responseStatus}`);
  if (e.responseText) bits.push(e.responseText);
  if (e.executedCommand) bits.push(`cmd=${e.executedCommand.slice(0, 300)}`);
  if (e.code) bits.push(`code=${e.code}`);
  return bits.join(" | ");
}

export function describeErrorWithCause(err: unknown, depth = 0): string {
  if (depth > 4) return "(max depth)";
  if (err instanceof Error) {
    const line = imapFailureDetailForLogs(err);
    if (err.cause !== undefined && err.cause !== null) {
      return `${line} | cause: ${describeErrorWithCause(err.cause, depth + 1)}`;
    }
    return line;
  }
  return String(err);
}

export function classifyImapFailure(err: unknown): ZenboxImapRetryableError | ZenboxImapPermanentError {
  if (err instanceof ZenboxImapRetryableError) return err;
  if (err instanceof ZenboxImapPermanentError) return err;
  const msg = imapFailureDetailForLogs(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("authenticationfailed") ||
    lower.includes("invalid credentials") ||
    (lower.includes("login") && lower.includes("fail")) ||
    lower.includes("no permission") ||
    lower.includes("mailbox doesn't exist") ||
    lower.includes("nonexistent mailbox")
  ) {
    return new ZenboxImapPermanentError(msg, { cause: err });
  }
  if (
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("socket") ||
    lower.includes("network") ||
    lower.includes("temporary") ||
    lower.includes("timeout")
  ) {
    return new ZenboxImapRetryableError(msg, { cause: err });
  }
  return new ZenboxImapPermanentError(msg, { cause: err });
}
