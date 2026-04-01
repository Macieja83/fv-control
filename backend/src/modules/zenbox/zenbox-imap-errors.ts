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

export function classifyImapFailure(err: unknown): ZenboxImapRetryableError | ZenboxImapPermanentError {
  if (err instanceof ZenboxImapRetryableError) return err;
  if (err instanceof ZenboxImapPermanentError) return err;
  const msg = err instanceof Error ? err.message : String(err);
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
