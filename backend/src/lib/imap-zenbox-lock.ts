import type { Redis } from "ioredis";
import { loadConfig } from "../config.js";

export async function tryAcquireImapZenboxLock(
  redis: Redis,
  tenantId: string,
  accountKey: string,
): Promise<{ key: string; acquired: boolean }> {
  const cfg = loadConfig();
  const key = `${cfg.BULLMQ_PREFIX}:imap:zenbox:sync:${tenantId}:${accountKey}`;
  const ok = await redis.set(key, "1", "EX", cfg.IMAP_ZENBOX_LOCK_TTL_SEC, "NX");
  return { key, acquired: ok === "OK" };
}

export async function releaseImapZenboxLock(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}
