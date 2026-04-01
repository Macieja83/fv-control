import * as IORedis from "ioredis";
import { loadConfig } from "../config.js";

type RedisClient = InstanceType<typeof IORedis.Redis>;

let shared: RedisClient | null = null;

export function getRedisConnection(): RedisClient {
  if (!shared) {
    const cfg = loadConfig();
    shared = new IORedis.Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return shared;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedisConnection();
    const p = await r.ping();
    return p === "PONG";
  } catch {
    return false;
  }
}
